// ═══════════════════════════════════════════════════════════════════════════
// @local/kybernos-modeles-locaux — client : le panneau « Modèles locaux », porté
// par UNE seule porte : la section dédiée « Ollama Local Models » des Réglages.
// Depuis le 02/10, ni le pied de la page Models native (`settings.models.footer`)
// ni la page « AI Provider & Models » (ancienne monture) ne le répètent.
//
// Le parcours (maquette v1 validée, docs/handoff/modeles-locaux) :
//   1. DÉTECTER  — GET /modeles-locaux/machine (sysctl, ollama --version,
//                  ollama list) : la machine, Ollama, les modèles déjà tirés.
//   2. RECOMMANDER — catalogue local (sources citées) filtré par la RAM mesurée.
//   3. INSTALLER — POST /modeles-locaux/installer : `ollama pull <id>` (ou
//                  `brew install ollama` d'abord, explicitement), progression
//                  lue sur la sortie du processus, annulable.
//   4. BRANCHER  — remote.settings.mutate('llm-pi-ai', …) : déclare la route
//                  `ollama-local` (baseURL http://127.0.0.1:11434/v1) et ses
//                  modèles — LE même canal que la page Models native. Chaque
//                  écriture porte un maillon ; si le modèle n'apparaît pas dans
//                  le sélecteur, le panneau le dit : relance de DSH.
//
// Honnêteté : rien n'est simulé ici. Une donnée absente s'affiche absente.
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
  id: '@local/kybernos-modeles-locaux',
  factory(require) {
    try {
      const React = require('react')
      const h = React.createElement

      const KB_NS = 'llm-pi-ai'
      const ROUTE_LOCALE = 'ollama-local'
      const BASE_LOCALE = 'http://127.0.0.1:11434/v1'

      // ── catalogue : les recommandations, sources citées ──────────────────
      // Last resort only (a host that does not know /modeles-locaux/catalogue yet): the same entries as the shipped
      // catalogue.json for these ids (a test pins it). Sizes: the Ollama registry's tag pages (15/10/2026); scores:
      // Artificial Analysis « Qwen3.5 small models » (05/03/2026). desc = the line under the name.
      const CATALOGUE_EMBARQUE = [
        { id: 'qwen3.5:9b', famille: 'q', initiale: 'Qw', tailleGo: 6.6, ramMin: 16, score: 'II 32 · MMMU-Pro 69 %',
          input: ['text', 'image'], badges: ['Vision', 'Tools', 'Thinking'],
          desc: 'kml.desc.9b' },
        { id: 'qwen3.5:4b', famille: 'q', initiale: 'Qw', tailleGo: 3.3, ramMin: 8, score: 'II 27 · MMMU-Pro 65 %',
          input: ['text', 'image'], badges: ['Vision', 'Tools'],
          desc: 'kml.desc.4b' },
        { id: 'qwen3.5:2b', famille: 'q', initiale: 'Qw', tailleGo: 2.7, ramMin: 8, score: 'II 16',
          input: ['text', 'image'], badges: ['Vision'],
          desc: 'kml.desc.2b' },
        { id: 'gemma4:e4b', famille: 'g', initiale: 'Gm', tailleGo: 6.6, ramMin: 16, score: 'audio natif · embarqué',
          input: ['text', 'image', 'audio'], badges: ['Vision', 'Audio'],
          desc: 'kml.desc.gemma' },
        { id: 'qwen3:14b', famille: 'q', initiale: 'Qw', tailleGo: 9.3, ramMin: 16, score: 'tools · thinking (Q4, Ollama)',
          input: ['text'], badges: ['Tools', 'Thinking'],
          desc: 'kml.desc.14b' },
        { id: 'qwen3-coder:30b', famille: 'q', initiale: 'Qw', tailleGo: 19, ramMin: 32, score: 'MoE 30B-A3B · code (Q4, Ollama)',
          input: ['text'], badges: ['Code', 'Tools'],
          desc: 'kml.desc.coder30' },
        { id: 'gemma3:1b', famille: 'g', initiale: 'Gm', tailleGo: 0.8, ramMin: 4, score: 'Ollama library · 0.8 GB · 32K ctx',
          input: ['text'], badges: [],
          desc: 'kml.desc.gemma1b' },
      ]
      // The list the page works on. It starts as the built-in one above (the last resort: a host that does not know the route
      // yet, or no answer) and is replaced by what /modeles-locaux/catalogue says: the list shipped with this version, or the
      // signed online one. Module-level on purpose: the first-run wizard asks for the recommendation through the same list.
      let CATALOGUE = CATALOGUE_EMBARQUE
      let kbCatalogueInfo = { source: 'embarque', publishedAt: null, online: null, nouveaux: [], hote: true }
      const kbAdopter = (rep) => {
        if (rep === null || typeof rep !== 'object' || rep.ok !== true || !Array.isArray(rep.models) || rep.models.length === 0) return false
        CATALOGUE = rep.models.map((x) => ({
          id: x.id, famille: x.famille, initiale: x.initiale, tailleGo: x.tailleGo, ramMin: x.ramMin, score: x.score === null || x.score === undefined ? '' : x.score,
          input: x.input, badges: x.badges, desc: x.desc, ajoute: x.ajoute,
        }))
        kbCatalogueInfo = { source: rep.source, publishedAt: rep.publishedAt, online: rep.online === undefined ? null : rep.online, nouveaux: Array.isArray(rep.nouveaux) ? rep.nouveaux : [], hote: true }
        return true
      }

      // ── i18n minimal (fr d'abord, en en repli) ───────────────────────────
      const KB_M_T = {
        'kml.soustitre': { fr: 'Un modèle qui tourne sur cette machine — détecté, recommandé, branché sur DSH.', en: 'A model running on this machine — detected, recommended, wired into DSH.' },
        'kml.machine': { fr: 'Machine :', en: 'Machine:' },
        'kml.mesure': { fr: 'mesuré — sysctl', en: 'measured — sysctl' },
        'kml.ollama.absent': { fr: 'absent', en: 'not installed' },
        'kml.ollama.arrete': { fr: "serveur arrêté : ouvrez l'app Ollama ou lancez « ollama serve »", en: 'server not running: open the Ollama app or run “ollama serve”' },
        'kml.ollama.note': { fr: 'installé au 1ᵉʳ téléchargement', en: 'installed on first download' },
        'kml.installer.ollama': { fr: 'Installer Ollama (brew)', en: 'Install Ollama (brew)' },
        'kml.reverifier': { fr: 'Revérifier', en: 'Re-check' },
        // (13/10) Refresh = real scan for newly installed models, with a
        // visible "Searching…" state and a result line afterwards.
        'kml.scan.encours': { fr: 'Recherche…', en: 'Searching…' },
        'kml.scan.nouveaux': { fr: '{n} nouveau(x) modèle(s) installé(s) dans Ollama depuis la dernière vérification : {ids}', en: '{n} new model(s) installed in Ollama since the last check: {ids}' },
        'kml.scan.aucun': { fr: 'Aucun nouveau modèle installé dans Ollama depuis la dernière vérification.', en: 'No new model installed in Ollama since the last check.' },
        'kml.scan.bouton': { fr: 'Rechercher de nouveaux modèles', en: 'Search for new models' },
        'kml.scan.tag': { fr: 'Nouveau', en: 'New' },
        // (15/10) Refresh also asks the catalogue of models (signed, verified): each step below is a real call, in this order.
        'kml.scan.etape.ollama': { fr: 'Lecture des modèles installés…', en: 'Reading the installed models…' },
        'kml.scan.etape.machine': { fr: 'Mesure de cette machine…', en: 'Measuring this machine…' },
        'kml.scan.etape.catalogue': { fr: 'Recherche de nouveaux modèles compatibles…', en: 'Looking for new compatible models…' },
        'kml.cat.nouveaux': { fr: '{n} nouveau(x) modèle(s) au catalogue depuis le {date} : {ids}.', en: '{n} new model(s) in the catalogue since {date}: {ids}.' },
        'kml.cat.tiennent': { fr: '{k} tiennent dans les {ram} Go de cette machine.', en: '{k} fit this machine’s {ram} GB.' },
        'kml.cat.aucun': { fr: 'Catalogue à jour : publié le {date}, aucun nouveau modèle.', en: 'Catalogue up to date: published {date}, no new model.' },
        'kml.cat.horsligne': { fr: 'Catalogue en ligne injoignable : la liste du {date} est conservée.', en: 'The online catalogue could not be reached: keeping the list from {date}.' },
        'kml.cat.refuse': { fr: 'Catalogue en ligne refusé ({raison}) : la liste du {date} est conservée.', en: 'The online catalogue was refused ({raison}): keeping the list from {date}.' },
        'kml.cat.nokey': { fr: 'La recherche en ligne n’est pas encore activée : liste livrée avec cette version ({date}).', en: 'Online search is not active yet: showing the list shipped with this version ({date}).' },
        'kml.cat.off': { fr: 'La recherche en ligne est désactivée dans les réglages.', en: 'Online search is turned off in the settings.' },
        'kml.cat.hote': { fr: 'Redémarrez DSH pour activer la recherche de nouveaux modèles.', en: 'Restart DSH to turn on the search for new models.' },
        'kml.cat.source.signe': { fr: 'Liste : catalogue signé · {date}', en: 'List: signed catalogue · {date}' },
        'kml.cat.source.livre': { fr: 'Liste : livrée avec cette version · {date}', en: 'List: shipped with this version · {date}' },
        'kml.cat.source.embarque': { fr: 'Liste : intégrée à la page (DSH à redémarrer pour la recherche en ligne)', en: 'List: built into the page (restart DSH for the online search)' },
        'kml.tuile.machine': { fr: 'Machine · mesuré (sysctl)', en: 'Machine · measured (sysctl)' },
        'kml.tuile.budget': { fr: 'Budget mémoire modèle · estimé', en: 'Model memory budget · estimated' },
        'kml.budget.note': { fr: '≈ RAM − 5 Go, DSH + Chrome ouverts', en: '≈ RAM − 5 GB, DSH + Chrome open' },
        'kml.tuile.moteur': { fr: 'Moteur local', en: 'Local engine' },
        'kml.moteur.port': { fr: 'localhost:11434', en: 'localhost:11434' },
        'kml.compatibles': { fr: 'Compatibles', en: 'Fits' },
        'kml.tous': { fr: 'Tous', en: 'All' },
        'kml.leger': { fr: 'Léger', en: 'Light' },
        'kml.reco': { fr: 'Recommandé', en: 'Recommended' },
        'kml.reco.tag': { fr: 'Recommandé', en: 'Recommended' },
        'kml.leger.tag': { fr: 'Léger', en: 'Light' },
        'kml.section.selection': { fr: 'Sélection pour cette machine', en: 'Picked for this machine' },
        'kml.etat.compatible': { fr: 'Compatible', en: 'Fits' },
        'kml.etat.juste': { fr: 'Juste', en: 'Tight' },
        'kml.etat.lourd': { fr: 'Trop lourd', en: 'Too heavy' },
        'kml.etat.inconnu': { fr: 'taille non mesurée', en: 'size not measured' },
        'kml.en.charge': { fr: 'en charge ≈ {go} Go', en: 'loaded ≈ {go} GB' },
        'kml.installer': { fr: 'Installer', en: 'Install' },
        'kml.en.cours': { fr: 'téléchargement…', en: 'downloading…' },
        'kml.brancher': { fr: 'Brancher sur DSH', en: 'Wire into DSH' },
        'kml.branche.tag': { fr: 'Branché', en: 'Wired' },
        'kml.resync.tip': { fr: 'Re-synchroniser la déclaration (niveaux de thinking…)', en: 'Re-sync the declaration (thinking levels…)' },
        'kml.branches.count': { fr: '{n} branché(s) sur DSH', en: '{n} wired into DSH' },
        'kml.section': { fr: 'Branché sur DSH', en: 'Wired into DSH' },
        // (01/10) Section Réglages dédiée — le panneau quitte le pied de la
        // page Models native pour sa propre entrée de navigation.
        'kml.page.titre': { fr: 'Modèles locaux Ollama', en: 'Ollama Local Models' },
        'kml.vide': { fr: 'Aucun modèle local branché — installe une recommandation ci-dessus.', en: 'No local model wired yet — install a recommendation above.' },
        'kml.relance': { fr: 'relance DSH si absent du sélecteur', en: 'restart DSH if missing from the picker' },
        'kml.contexte': { fr: 'Contexte', en: 'Context' },
        'kml.erreur': { fr: 'Erreur', en: 'Error' },
        'kml.hors-champ': { fr: 'au-dessus de la RAM mesurée', en: 'above the measured RAM' },
        'kml.hf.ouvrir': { fr: 'Modèle personnalisé (Hugging Face)', en: 'Custom model (Hugging Face)' },
        'kml.hf.titre': { fr: 'Télécharger un modèle depuis Hugging Face', en: 'Download a model from Hugging Face' },
        'kml.hf.label': { fr: 'Lien Hugging Face', en: 'Hugging Face link' },
        'kml.hf.placeholder': { fr: 'https://huggingface.co/org/repo/…q4_k_m.gguf', en: 'https://huggingface.co/org/repo/…q4_k_m.gguf' },
        'kml.hf.verifier': { fr: 'Vérifier la compatibilité', en: 'Check compatibility' },
        'kml.hf.verif.encours': { fr: 'Vérification…', en: 'Checking…' },
        'kml.hf.exemple': { fr: 'Exemple :', en: 'Example:' },
        'kml.hf.telecharger': { fr: 'Télécharger via Ollama', en: 'Download via Ollama' },
        'kml.hf.champ.lien': { fr: 'Lien', en: 'Link' },
        'kml.hf.champ.format': { fr: 'Format', en: 'Format' },
        'kml.hf.champ.quant': { fr: 'Quantification', en: 'Quantization' },
        'kml.hf.champ.memoire': { fr: 'Mémoire (estimée)', en: 'Memory (estimated)' },
        'kml.hf.champ.gpu': { fr: 'Accélération', en: 'Acceleration' },
        'kml.hf.err.lien': { fr: 'Lien invalide.', en: 'Invalid link.' },
        'kml.hf.err.format': { fr: 'Le dépôt ne semble pas contenir de GGUF.', en: 'The repository does not look like a GGUF.' },
        'kml.hf.gguf': { fr: 'GGUF', en: 'GGUF' },
        'kml.hf.gguf.absent': { fr: 'GGUF non visible dans le lien', en: 'GGUF not visible in the link' },
        'kml.hf.metal': { fr: 'Metal (Apple Silicon)', en: 'Metal (Apple Silicon)' },
        'kml.hf.metal.cpu': { fr: 'CPU (accélérateur non détecté)', en: 'CPU (no accelerator detected)' },
        'kml.installer.hf.hors-champ': { fr: 'Trop lourd pour cette machine — rien ne sera téléchargé.', en: 'Too heavy for this machine — nothing will be downloaded.' },
        // (13/10) Catalogue descriptions — i18n wrap (was bare French only).
        'kml.desc.9b': { fr: 'Le meilleur sous 10B — rentre avec DSH + Chrome ouverts (16 Go).', en: 'Best under 10B — fits with DSH + Chrome open (16 GB).' },
        'kml.desc.4b': { fr: 'Marge maximale — le choix des machines à 8 Go.', en: 'Maximum headroom — the pick for 8 GB machines.' },
        'kml.desc.2b': { fr: 'Pour les petites machines : le plus petit des Qwen 3.5 avec la vision.', en: 'For small machines: the smallest Qwen 3.5 that does not trade away vision.' },
        'kml.desc.gemma': { fr: 'Alternative on-device si le 9B s\u2019avère lent.', en: 'On-device alternative if the 9B turns out slow.' },
        'kml.desc.14b': { fr: 'Génération précédente — au-dessus du budget avec DSH ouvert.', en: 'Previous generation — over budget with DSH open.' },
        'kml.desc.gemma1b': { fr: 'Gemma 3 (Google), version 1B : texte seul, contexte 32K. Pour 4 Go.', en: 'Gemma 3 (Google), 1B version: text only, 32K context. For 4 GB.' },
        'kml.desc.coder30': { fr: 'Hors budget sur cette machine — rien ne sera téléchargé.', en: 'Over budget on this machine — nothing will be downloaded.' },
      }
      let kbLocaleRead = () => 'en'
      // Text separator, locale-aware: French ' : ', English ': '.
      const sep = () => (String(kbLocaleRead()).toLowerCase().indexOf('fr') === 0 ? ' : ' : ': ')
      const m = (key, vars) => {
        let lang = 'en'
        try { lang = String(kbLocaleRead()) } catch (e) { lang = 'en' }
        const entry = KB_M_T[key]
        let text = entry === null || entry === undefined ? key : (entry[lang] !== undefined ? entry[lang] : entry.en)
        if (vars !== null && vars !== undefined) {
          for (const k of Object.keys(vars)) text = text.split('{' + k + '}').join(String(vars[k]))
        }
        return text
      }

      // A built-in entry points at a string above; a catalogue entry carries its own { fr, en }.
      const descDe = (mod) => {
        if (typeof mod.desc === 'string') return m(mod.desc)
        if (mod.desc === null || typeof mod.desc !== 'object') return ''
        let lang = 'en'
        try { lang = String(kbLocaleRead()) } catch (e) { lang = 'en' }
        return typeof mod.desc[lang] === 'string' ? mod.desc[lang] : (typeof mod.desc.en === 'string' ? mod.desc.en : '')
      }
      const dateDe = (iso) => {
        try { return new Date(iso).toLocaleDateString(String(kbLocaleRead()) === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) } catch (e) { return String(iso).slice(0, 10) }
      }

      // ── icônes (tracés Lucide, comme les autres plugins) ─────────────────
      const ICONS = {
        download: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 21h16'],
        check: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M8 12l3 3 5-6'],
        refresh: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
        search: ['M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'M21 21l-4.35-4.35'],
        trash: ['M3 6h18', 'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2', 'M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14', 'M10 11v6', 'M14 11v6'],
        link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
      }
      const Ic = (name, size) => {
        const d = ICONS[name]
        if (d === undefined) return null
        const w = size === undefined ? 16 : size
        return h('svg', { width: w, height: w, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false', style: { flex: 'none' } },
          d.map((p, i) => h('path', { d: p, key: i })))
      }

      // ── Hugging Face : analyse du lien, estimation mémoire (leur logique,
      // honnêteté inchangée : une donnée estimée s'affiche « estimée ») ─────
      const HF_QUANT_BITS = { Q2: 3.2, Q3: 3.6, IQ3: 3.4, IQ4: 4.25, Q4: 4.83, Q5: 5.5, Q6: 6.6, Q8: 8.5, BF16: 16, F16: 16, F32: 32 }
      const bitsDe = (quant) => {
        if (quant === null) return 4.83
        for (const cle of ['BF16', 'F32', 'F16', 'IQ4', 'IQ3', 'Q8', 'Q6', 'Q5', 'Q4', 'Q3', 'Q2']) {
          if (String(quant).toUpperCase().indexOf(cle) === 0) return HF_QUANT_BITS[cle]
        }
        return 4.83
      }
      const parseHF = (url) => {
        const li = String(url || '').trim()
        const u = li.match(/^https?:\/\/(?:huggingface\.co|hf\.co)\/([^\/\s?#]+)\/([^\/\s?#]+)/i)
        if (u === null) return { ok: false, verdict: 'lien' }
        const org = u[1]
        const repo = u[2].replace(/\.git$/, '')
        const estGGUF = /\.gguf($|\?|#)/i.test(li) || /gguf/i.test(repo)
        if (estGGUF === false) return { ok: false, verdict: 'format', org, repo }
        const mq = li.match(/(IQ\d_[A-Z0-9_]+|Q\d(?:_[A-Z0-9]+)*|BF16|F16|F32)/i)
        const quant = mq !== null ? mq[1].toUpperCase() : null
        const mp = (repo + ' ' + li).match(/(\d+(?:\.\d+)?)\s*[bB]\b/)
        const params = mp !== null ? parseFloat(mp[1]) : null
        const poidsGo = params !== null ? Math.round(params * bitsDe(quant) / 8 * 1.05 * 10) / 10 : null
        const enChargeGo = poidsGo !== null ? Math.round(poidsGo * 1.25 * 10) / 10 : null
        return { ok: true, org, repo, quant, params, poidsGo, enChargeGo, cible: 'hf.co/' + org + '/' + repo + (quant !== null ? ':' + quant : '') }
      }

      // ── styles : contrôles kbm-* (contrat partagé) + mise en page kml-* ──
      // Si kybernos-models a déjà injecté le jeu kbm-* (mêmes classes, même
      // contrat), on ne réinjecte que notre mise en page.
      const styles = (() => {
        const tags = new Set()
        return {
          insert(css, marque) {
            const tag = document.createElement('style')
            tag.dataset.plugin = marque
            tag.textContent = css
            document.head.append(tag)
            tags.add(tag)
            return () => { tags.delete(tag); tag.remove() }
          },
        }
      })()

      const KBM_CSS = "/* kbm-* : le contrat partagé des plugins Kybernos (extrait dsh.css, scripts/build-model-catalog-css.mjs) */\n" +
        ".kbm-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; border: none; border-radius: 18px; cursor: pointer; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); background: transparent; padding: 0 14px; }\n" +
        ".kbm-btn:disabled { cursor: not-allowed; opacity: 0.4; }\n" +
        ".kbm-btn-md { height: 36px; }\n" +
        ".kbm-btn-sm { height: 28px; font-size: 12px; line-height: 18px; padding: 0 10px; border-radius: 14px; }\n" +
        ".kbm-btn-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }\n" +
        ".kbm-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }\n" +
        ".kbm-btn-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }\n" +
        ".kbm-btn-outline { border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; }\n" +
        ".kbm-btn-outline:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }\n" +
        ".kbm-in-wrap { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 8px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }\n" +
        ".kbm-in-wrap:focus-within { border-color: var(--dsw-alias-brand-primary); }\n" +
        ".kbm-in-icon { display: inline-flex; width: 16px; height: 16px; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary); }\n" +
        ".kbm-in-input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); }\n" +
        ".kbm-in-input::placeholder { color: var(--dsw-alias-label-dimmed); }\n" +
        ".kbm-pill { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border: none; border-radius: 12px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }\n" +
        ".kbm-pill-interactive { cursor: pointer; }\n" +
        ".kbm-pill-interactive:hover { background: var(--dsw-alias-interactive-bg-hover); }\n" +
        ".kbm-pill-active { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-button-ghost-active-fill); box-shadow: inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border); }\n" +
        ".kbm-tag { display: inline-flex; align-items: center; border-radius: 999px; padding: 1px 8px; font-size: 11px; line-height: 17px; font-weight: 500; white-space: nowrap; }\n" +
        ".kbm-tag[data-tone='outline'] { border: 0.5px solid var(--dsw-alias-border-l4); color: var(--dsw-alias-label-tertiary); }\n" +
        ".kbm-tag[data-tone='neutral'] { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }\n" +
        ".kbm-tag[data-tone='quiet'] { color: var(--dsw-alias-label-tertiary); }\n" +
        ".kbm-tag[data-tone='success'] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); color: var(--dsw-alias-state-success-primary); }\n" +
        ".kbm-tag[data-tone='warning'] { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent); color: var(--dsw-alias-state-warn-primary); }\n" +
        ".kbm-tag[data-tone='danger'] { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); color: var(--dsw-alias-state-error-primary); }\n" +
        ".kml-scan-btn { display: inline-flex; align-items: center; gap: 4px; }\n" +
        ".kml-spin { display: inline-flex; animation: kml-rot 0.9s linear infinite; }\n" +
        "@keyframes kml-rot { to { transform: rotate(360deg); } }\n" +
        ".kml-scan-result { margin: 6px 0 0; font-size: 12px; }\n" +
        ".kml-scan-result[data-ok='true'] { color: var(--dsw-alias-state-success-primary); }\n" +
        ".kml-scan-result[data-ok='false'] { color: var(--dsw-alias-label-tertiary); }\n" +
        ".kbm-dot { position: relative; display: inline-block; flex: none; width: 10px; height: 10px; }\n" +
        ".kbm-dot::after { content: ''; position: absolute; inset: 20%; border-radius: 50%; background: currentColor; }\n" +
        ".kbm-dot[data-state='done'] { color: var(--dsw-alias-state-success-primary); }\n" +
        ".kbm-dot[data-state='warning'] { color: var(--dsw-alias-state-warn-primary); }\n" +
        ".kbm-dot[data-state='error'] { color: var(--dsw-alias-state-error-primary); }\n" +
        ".kbm-dot[data-state='idle'] { color: var(--dsw-alias-state-idle-primary); }\n"

      const KML_CSS = "/* kml-* : mise en page du panneau Modèles locaux (ce bundle seulement — tokens DSH) */\n" +
        ".kbm-resync { cursor: pointer; font: inherit; border: none; background: none; padding: 0; }\n" +
        ".kml-root { border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-layer-2); padding: 16px; max-width: 720px; margin-bottom: 16px; }\n" +
        ".kml-titre { margin: 0; font-size: 18px; line-height: 1.3; font-weight: 600; letter-spacing: -.01em; color: var(--dsw-alias-label-primary); }\n" +
        ".kml-soustitre { margin: 6px 0 20px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.5; }\n" +
        ".kml-tuiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 0 0 12px; }\n" +
        ".kml-tuile { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 10px 12px; min-width: 0; }\n" +
        ".kml-tuile-legend { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }\n" +
        ".kml-tuile-valeur { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 24px; font-size: 14px; line-height: 20px; color: var(--dsw-alias-label-primary); }\n" +
        ".kml-tuile-ligne { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }\n" +
        ".kml-tuile-note { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }\n" +
        ".kml-hf-tete { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 12px; }\n" +
        ".kml-hf { display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 12px; margin: 0 0 12px; }\n" +
        ".kml-hf-sous { margin: 0; font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }\n" +
        ".kml-hf-rangee { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }\n" +
        ".kml-hf-saisie { flex: 1; min-width: 260px; }\n" +
        ".kml-hf-ex { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }\n" +
        ".kml-hf-ex-lien { border: none; background: transparent; padding: 0; cursor: pointer; font-family: var(--ds-font-family-code, monospace); font-size: 12px; line-height: 18px; color: var(--dsw-alias-brand-primary); }\n" +
        ".kml-hf-ex-lien:hover { text-decoration: underline; }\n" +
        ".kml-hf-verdict { display: flex; flex-direction: column; gap: 4px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); border-top: 1px dashed var(--dsw-alias-border-l2); padding-top: 10px; }\n" +
        ".kml-hf-verdict b { font-weight: 500; color: var(--dsw-alias-label-primary); }\n" +
        ".kml-hf-avertis { margin: 2px 0 0; font-size: 13px; color: var(--dsw-alias-state-warn-primary); }\n" +
        ".kml-hf-cours { display: flex; align-items: center; gap: 10px; }\n" +
        ".kml-hf-cours .kml-prog { flex: 1; }\n" +
        ".kml-outils { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 10px; }\n" +
        ".kml-section-inline { margin: 0 10px 0 0; }\n" +
        ".kml-liste { display: flex; flex-direction: column; gap: 6px; margin: 0 0 6px; }\n" +
        ".kml-mod { display: flex; align-items: center; gap: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 10px 12px; }\n" +
        ".kml-mod-chip { width: 30px; height: 30px; flex: none; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; font-size: 11px; font-weight: 700; letter-spacing: .3px; }\n" +
        ".kml-mod-chip[data-famille='q'] { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); color: var(--dsw-alias-brand-primary); }\n" +
        ".kml-mod-chip[data-famille='g'] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent); color: var(--dsw-alias-state-success-primary); }\n" +
        "body:not([data-ds-dark-theme]) .kml-mod-chip[data-famille='g'] { color: color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-label-primary)); }\n" +
        ".kml-mod-corps { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }\n" +
        ".kml-mod-tete { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }\n" +
        ".kml-mod-nom { font-family: var(--ds-font-family-code, monospace); font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }\n" +
        ".kml-mod-desc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n" +
        ".kml-mod-etat { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 3px; min-width: 150px; }\n" +
        ".kml-etat { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }\n" +
        ".kml-etat-sous { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }\n" +
        ".kml-bar { width: 100%; max-width: 150px; height: 4px; border-radius: 2px; background: var(--dsw-alias-bg-layer-3); overflow: hidden; }\n" +
        ".kml-bar-fill { display: block; height: 100%; border-radius: 2px; background: var(--dsw-alias-state-success-primary); }\n" +
        ".kml-bar-fill[data-etat='juste'] { background: var(--dsw-alias-state-warn-primary); }\n" +
        ".kml-bar-fill[data-etat='lourd'] { background: var(--dsw-alias-state-error-primary); }\n" +
        ".kml-bar-fill[data-etat='inconnu'] { background: var(--dsw-alias-bg-module-platform); }\n" +
        ".kml-mod-actions { flex: none; display: flex; align-items: center; gap: 8px; min-width: 132px; justify-content: flex-end; }\n" +
        ".kml-prog { flex: 1; min-width: 90px; height: 6px; border-radius: 3px; background: var(--dsw-alias-bg-layer-3); overflow: hidden; }\n" +
        ".kml-prog-fill { height: 100%; border-radius: 3px; background: var(--dsw-alias-brand-primary); transition: width .4s ease; }\n" +
        ".kml-prog-texte { font-size: 13px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }\n" +
        ".kml-section { font-size: 12px; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); margin: 14px 0 8px; }\n" +
        ".kml-vide { color: var(--dsw-alias-label-secondary); font-size: 14px; padding: 14px; background: var(--dsw-alias-bg-layer-1); border: 1px dashed var(--dsw-alias-border-l3); border-radius: 10px; margin: 0; }\n" +
        ".kml-rangee { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-height: 52px; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 11px; background: var(--dsw-alias-bg-layer-1); margin: 0 0 8px; }\n" +
        ".kml-rangee-init { width: 26px; height: 26px; flex: none; display: flex; align-items: center; justify-content: center; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }\n" +
        ".kml-rangee-nom { font-family: var(--ds-font-family-code, monospace); font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary); }\n" +
        ".kml-rangee-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-left: auto; }\n" +
        ".kml-rangee-meta .kbm-in-wrap { width: 132px; }\n" +
        ".kml-erreur { margin: 0 0 12px; font-size: 13px; color: var(--dsw-alias-state-error-primary); }\n" +
        ".kml-scan-source { margin: 0 0 10px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }\n" +
        "@media (max-width: 900px) { .kml-tuiles { grid-template-columns: 1fr; } }\n" +
        "@media (max-width: 720px) { .kml-mod { flex-wrap: wrap; } .kml-mod-etat { align-items: flex-start; } .kml-mod-actions { justify-content: flex-start; } .kml-hf-saisie { min-width: 100%; } }\n"

      // ── le profil de la route locale, et ce que le premier lancement de Kybernos en utilise ──
      // Le panneau (brancher) et l'assistant de premier lancement (window.__KB_LOCAL__, plus bas) construisent
      // la route de la même façon : un seul endroit.
      const kbBuildProfile = (existing, mod) => {
        const prof = existing !== null && existing !== undefined ? JSON.parse(JSON.stringify(existing)) : {}
        if (typeof prof.api !== 'string' || prof.api.length === 0) prof.api = 'openai-completions'
        if (typeof prof.baseURL !== 'string' || prof.baseURL.length === 0) prof.baseURL = BASE_LOCALE
        // pi-ai refuse un fournisseur sans clé (« No API key », mesuré 27/09)
        // même pour un moteur local qui l'ignore : clé factice au coffre.
        if (typeof prof.apiKeyEnv !== 'string' || prof.apiKeyEnv.length === 0) prof.apiKeyEnv = 'OLLAMA_LOCAL_API_KEY'
        const modeles = Array.isArray(prof.models) ? prof.models.filter((x) => x && x.id !== mod.id) : []
        // Les qwen3.5 « pensent » par défaut et l'endpoint OpenAI d'Ollama ne
        // coupe ça que par reasoning_effort (mesuré 27/09 : « think:false »
        // ignoré, « reasoning_effort:'none' » → réponse immédiate). On déclare
        // donc les niveaux (off→none, low, medium, high) et le compat qui
        // laisse pi-ai envoyer le paramètre — le sélecteur apparaît dans DSH.
        const pense = /^(qwen3([.\-_]|$)|qwen3\.5|deepseek-r1|qwq)/.test(mod.id)
        const entree = { id: mod.id, name: mod.id, contextWindow: 32768, input: (mod.input || ['text', 'image']).slice() }
        if (pense === true) {
          entree.reasoningEfforts = { off: 'none', low: 'low', medium: 'medium', high: 'high' }
          entree.compat = { supportsReasoningEffort: true }
        }
        modeles.push(entree)
        prof.models = modeles
        return prof
      }
      // La recommandation : le PLUS GRAND modèle qui tient dans la RAM mesurée. Le catalogue est trié du plus
      // grand au plus petit : le premier qui passe le filtre EST le plus grand qui convient (mesuré 27/09 :
      // prendre le DERNIER faisait porter « Recommandé » à gemma4:e4b au lieu du 9B).
      const kbRecommend = (ramGo) => {
        const possibles = CATALOGUE.filter((mod) => ramGo === null || ramGo === undefined || mod.ramMin <= ramGo)
        return possibles.length > 0 ? possibles[0] : null
      }

      // ── accès services ───────────────────────────────────────────────────
      let kbCtx = null
      const kbMApi = () => {
        const c = kbCtx
        if (c === null || c === undefined || c.remote === null || c.remote === undefined) return null
        return { settings: c.remote.settings === undefined ? null : c.remote.settings }
      }
      const jsonGet = async (chemin) => {
        const r = await fetch(chemin, { headers: { 'content-type': 'application/json' } })
        const t = await r.text()
        try { return JSON.parse(t) } catch (e) { return { ok: false, error: 'reponse' } }
      }
      const jsonPost = async (chemin, corps) => {
        const r = await fetch(chemin, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps === undefined ? {} : corps) })
        const t = await r.text()
        try { return JSON.parse(t) } catch (e) { return { ok: false, error: 'reponse' } }
      }

      // ── le panneau ───────────────────────────────────────────────────────
      const LigneContexte = (props) => {
        const [valeur, setValeur] = React.useState(String(props.modele.contextWindow === undefined || props.modele.contextWindow === null ? '' : props.modele.contextWindow))
        React.useEffect(() => { setValeur(String(props.modele.contextWindow === undefined || props.modele.contextWindow === null ? '' : props.modele.contextWindow)) }, [props.modele.contextWindow])
        const valider = () => {
          const n = Number(valeur.trim())
          if (valeur.trim() !== '' && Number.isFinite(n) && n > 0 && n !== props.modele.contextWindow) props.onContexte(n)
        }
        return h('span', { className: 'kbm-in-wrap' },
          h('input', {
            className: 'kbm-in-input', value: valeur, inputMode: 'numeric',
            title: m('kml.contexte') + ' (tokens)', 'aria-label': m('kml.contexte') + ' ' + props.modele.id,
            onChange: (e) => setValeur(e.target.value),
            onBlur: valider,
            onKeyDown: (e) => { if (e.key === 'Enter') valider() },
          }))
      }

      const Panel = () => {
        const [machine, setMachine] = React.useState(null)
        const [machineErreur, setMachineErreur] = React.useState(null)
        const [job, setJob] = React.useState(null)
        const [erreur, setErreur] = React.useState(null)
        const [budget, setBudget] = React.useState('tous')
        const [ollamaLocal, setOllamaLocal] = React.useState(null)
        const [hfOuvre, setHfOuvre] = React.useState(false)
        const [hfUrl, setHfUrl] = React.useState('')
        const [hfPhase, setHfPhase] = React.useState('idle')
        const [hfResult, setHfResult] = React.useState(null)
        const [revision, setRevision] = React.useState(null)
        const [writable, setWritable] = React.useState(true)
        // Refresh scan: 'inactif' | 'encours' | 'fini' + the ids found new.
        const [scan, setScan] = React.useState('inactif')
        const [scanNouveaux, setScanNouveaux] = React.useState(null)
        // Which real call is running (ollama → machine → catalogue), and what the catalogue answered.
        const [scanEtape, setScanEtape] = React.useState(null)
        const [catBilan, setCatBilan] = React.useState(null)
        const [catRev, setCatRev] = React.useState(0)
        const jobVivant = React.useRef(null)

        // ── lectures réelles ───────────────────────────────────────────────
        const chargerMachine = React.useCallback(async (force) => {
          try {
            const r = await jsonGet('/modeles-locaux/machine' + (force === true ? '?force=1' : ''))
            if (r.ok === true) { setMachine(r.machine); setMachineErreur(null) }
            else setMachineErreur(String(r.error || 'machine'))
          } catch (e) { setMachineErreur(String(e && e.message ? e.message : e)) }
        }, [])
        // Refresh = a REAL interrogation of the Ollama server (/api/tags via
        // /modeles-locaux/decouvrir), diffed against the ids seen last time.
        // The button shows "Searching…" while it runs, then the result.
        const lancerScan = React.useCallback(async () => {
          setScan('encours')
          setCatBilan(null)
          setScanEtape('ollama')
          try {
            const r = await jsonPost('/modeles-locaux/decouvrir', {})
            if (r.ok === true) setScanNouveaux(Array.isArray(r.nouveaux) ? r.nouveaux : [])
            else setScanNouveaux([])
          } catch (e) { setScanNouveaux([]) }
          setScanEtape('machine')
          await chargerMachine(true)
          setScanEtape('catalogue')
          // The catalogue of models: the host verifies the signature before it believes a word (see modeles-catalogue.mjs).
          let bilan = null
          try {
            const r = await jsonPost('/modeles-locaux/catalogue', { op: 'refresh' })
            if (r !== null && r.ok === true && kbAdopter(r) === true) bilan = { ok: true, online: r.online, nouveaux: kbCatalogueInfo.nouveaux, depuis: r.depuis, publishedAt: r.publishedAt, source: r.source }
            else bilan = { ok: false, hote: false }
          } catch (e) { bilan = { ok: false, hote: false } }
          if (bilan.ok === false) kbCatalogueInfo = Object.assign({}, kbCatalogueInfo, { hote: false })
          setCatBilan(bilan)
          setCatRev((n) => n + 1)
          setScanEtape(null)
          setScan('fini')
        }, [chargerMachine])
        // The list on screen at load: what the host holds on disk (no network).
        React.useEffect(() => {
          let vivant = true
          jsonGet('/modeles-locaux/catalogue').then((r) => { if (vivant === true && kbAdopter(r) === true) setCatRev((n) => n + 1) }).catch(() => { /* host without the route: the built-in list stays */ })
          return () => { vivant = false }
        }, [])
        const chargerDoc = React.useCallback(async () => {
          const api = kbMApi()
          if (api === null || api.settings === null) return
          try {
            const resp = await api.settings.describe()
            if (resp === null || resp.ok !== true) return
            setWritable(resp.value.writable === true)
            const namespaces = Array.isArray(resp.value.namespaces) ? resp.value.namespaces : []
            const vue = namespaces.filter((n) => n.ns === KB_NS)[0]
            if (vue === undefined) return
            if (typeof vue.revision === 'number') setRevision(vue.revision)
            const value = vue.value && typeof vue.value === 'object' ? vue.value : {}
            const providers = value.providers && typeof value.providers === 'object' ? value.providers : {}
            const prof = providers[ROUTE_LOCALE]
            setOllamaLocal(prof && typeof prof === 'object' ? prof : null)
          } catch (e) { /* le panneau reste sur son état — Revérifier relit */ }
        }, [])

        // ── le job d'installation, interrogé toutes les 600 ms ─────────────
        React.useEffect(() => {
          if (job === null || job.running !== true) return undefined
          const t = setInterval(async () => {
            const r = await jsonGet('/modeles-locaux/installation')
            if (r.ok === true && r.job !== null && r.job !== undefined) {
              setJob(r.job)
              if (r.job.running !== true && jobVivant.current !== null) {
                clearInterval(jobVivant.current)
                jobVivant.current = null
                chargerMachine(true)
                setErreur(r.job.ok === true ? null : (r.job.annule === true ? null : (m('kml.erreur') + sep() + String(r.job.ligne || r.job.cmd))))
              }
            }
          }, 600)
          jobVivant.current = t
          return () => { clearInterval(t); jobVivant.current = null }
        }, [job === null ? null : (job.running === true ? 'cours' : 'fini'), chargerMachine])

        React.useEffect(() => { chargerMachine(false); chargerDoc() }, [chargerMachine, chargerDoc])

        // ── actions ────────────────────────────────────────────────────────
        const installer = async (cible, avecMoteur) => {
          setErreur(null)
          const r = await jsonPost('/modeles-locaux/installer', { cible, installeMoteur: avecMoteur === true })
          if (r.ok !== true) {
            setErreur(m('kml.erreur') + sep() + String(r.error || 'refus') + (r.astuce ? ' — ' + r.astuce : ''))
            return
          }
          setJob({ cible, cmd: r.cmd, running: true, pct: null, octets: null, ligne: '' })
        }
        const verifierHF = () => {
          if (hfUrl.trim() === '') return
          setHfResult(parseHF(hfUrl))
          setHfPhase('done')
        }
        const annuler = async () => { await jsonPost('/modeles-locaux/annuler', {}) }
        const muter = async (ops) => {
          const api = kbMApi()
          if (api === null || api.settings === null) { setErreur(m('kml.erreur') + ' : remote.settings absent'); return false }
          try {
            const raw = await api.settings.mutate(KB_NS, ops, revision)
            const resp = raw === null || raw === undefined ? { ok: false } : raw
            if (resp.ok !== true) {
              setErreur(m('kml.erreur') + sep() + String(resp.error && (resp.error.code || resp.error.message) ? (resp.error.code || resp.error.message) : 'refus'))
              return false
            }
            if (resp.value && typeof resp.value.revision === 'number') setRevision(resp.value.revision)
            await chargerDoc()
            return true
          } catch (e) {
            setErreur(m('kml.erreur') + sep() + String(e && e.message ? e.message : e))
            return false
          }
        }
        const brancher = async (mod) => {
          await muter([{ op: 'set', path: ['providers', ROUTE_LOCALE], value: kbBuildProfile(ollamaLocal, mod) }])
        }
        const debrancher = async (id) => {
          if (ollamaLocal === null) return
          const prof = JSON.parse(JSON.stringify(ollamaLocal))
          const modeles = Array.isArray(prof.models) ? prof.models.filter((x) => x && x.id !== id) : []
          if (modeles.length === 0) { await muter([{ op: 'unset', path: ['providers', ROUTE_LOCALE] }]); return }
          prof.models = modeles
          await muter([{ op: 'set', path: ['providers', ROUTE_LOCALE], value: prof }])
        }
        const majContexte = async (id, contexte) => {
          if (ollamaLocal === null) return
          const prof = JSON.parse(JSON.stringify(ollamaLocal))
          prof.models = (Array.isArray(prof.models) ? prof.models : []).map((x) => (x && x.id === id ? Object.assign({}, x, { contextWindow: contexte }) : x))
          await muter([{ op: 'set', path: ['providers', ROUTE_LOCALE], value: prof }])
        }

        // ── dérivés ────────────────────────────────────────────────────────
        const ramGo = machine !== null && machine.ramGo !== null ? machine.ramGo : null
        const budgetGo = ramGo === null ? null : Math.max(1, ramGo - 5)
        const installees = machine !== null && Array.isArray(machine.ollama.models) ? machine.ollama.models : []
        const branchees = ollamaLocal !== null && Array.isArray(ollamaLocal.models) ? ollamaLocal.models : []
        // En charge ≈ taille du fichier × 1,25 (KV-cache + runtime) — estimé,
        // affiché comme tel. État : Compatible ≤ budget, Juste ≤ RAM, sinon lourd.
        const enChargeDe = (mod) => (mod.tailleGo === null ? null : Math.round(mod.tailleGo * 1.25 * 10) / 10)
        const etatDe = (mod) => {
          const ec = enChargeDe(mod)
          if (ec === null) return 'inconnu'
          if (budgetGo !== null && ec <= budgetGo) return 'compatible'
          if (ramGo !== null && ec <= ramGo) return 'juste'
          return 'lourd'
        }
        const reco = kbRecommend(ramGo)
        // Ids found by the last Refresh scan: highlighted with a "New" tag.
        const idsNouveaux = new Set((scanNouveaux !== null ? scanNouveaux.map((x) => x.id) : []).concat(catBilan !== null && catBilan.ok === true ? catBilan.nouveaux : []))
        const visibles = CATALOGUE.filter((mod) => {
          if (budget === 'compatibles') return etatDe(mod) === 'compatible'
          if (budget === 'reco') return mod === reco
          if (budget === 'leger') return mod.tailleGo !== null && mod.tailleGo <= 4
          return true
        })

        const rangeeDe = (mod) => {
          const estInstalle = installees.some((x) => x.id === mod.id)
          const estBranche = branchees.some((x) => x.id === mod.id)
          const enCours = job !== null && job.cible === mod.id && job.running === true
          const etat = etatDe(mod)
          const ec = enChargeDe(mod)
          let actions
          if (enCours === true) {
            actions = [
              h('div', { className: 'kml-prog', key: 'p' }, h('div', { className: 'kml-prog-fill', style: { width: (job.pct === null ? 4 : job.pct) + '%' } })),
              h('span', { className: 'kml-prog-texte', key: 't' },
                job.pct === null ? m('kml.en.cours') : job.pct + ' %' + (job.octets !== null ? ' · ' + job.octets.recu + ' / ' + job.octets.total : '')),
              h('button', { className: 'kbm-btn kbm-btn-sm kbm-btn-outline', key: 'a', onClick: annuler, title: 'Annuler' }, '✕'),
            ]
          } else if (estBranche === true) {
            // L'étiquette est cliquable : re-brancher resynchronise la
            // déclaration (niveaux de thinking, fenêtre…) sans désinstaller.
            actions = [h('button', { className: 'kbm-tag kbm-resync', 'data-tone': 'success', key: 'ok',
              title: m('kml.resync.tip'), onClick: () => brancher(mod) }, Ic('check', 11), ' ', m('kml.branche.tag'))]
          } else if (estInstalle === true) {
            actions = [
              h('button', { className: 'kbm-btn kbm-btn-md kbm-btn-primary', key: 'b', onClick: () => brancher(mod) }, Ic('link', 14), m('kml.brancher')),
            ]
          } else if (etat === 'lourd') {
            actions = [h('button', { className: 'kbm-btn kbm-btn-md kbm-btn-outline', key: 'd', disabled: true, title: m('kml.hors-champ') }, m('kml.installer'))]
          } else {
            actions = [
              h('button', { className: 'kbm-btn kbm-btn-md ' + (mod === reco ? 'kbm-btn-primary' : 'kbm-btn-outline'), key: 'd', onClick: () => installer(mod.id, true) }, Ic('download', 14), m('kml.installer')),
            ]
          }
          return h('div', { className: 'kml-mod', key: mod.id, 'data-kml-carte': mod.id, 'data-etat': etat },
            h('span', { className: 'kml-mod-chip', 'data-famille': mod.famille }, mod.initiale),
            h('span', { className: 'kml-mod-corps' },
              h('span', { className: 'kml-mod-tete' },
                h('span', { className: 'kml-mod-nom' }, mod.id),
                h('span', { className: 'kbm-tag', 'data-tone': 'outline' }, 'Q4'),
                mod === reco ? h('span', { className: 'kbm-tag', 'data-tone': 'success' }, m('kml.reco.tag')) : null,
                idsNouveaux.has(mod.id) ? h('span', { className: 'kbm-tag', 'data-tone': 'warning' }, m('kml.scan.tag')) : null,
                mod.tailleGo !== null && mod.tailleGo <= 4 ? h('span', { className: 'kbm-tag', 'data-tone': 'quiet' }, m('kml.leger.tag')) : null),
              h('span', { className: 'kml-mod-desc', title: descDe(mod) + (mod.score ? ' · ' + mod.score : '') }, descDe(mod) + (mod.score ? ' · ' + mod.score : ''))),
            h('span', { className: 'kml-mod-etat' },
              h('span', { className: 'kml-etat' },
                h('span', { className: 'kbm-dot', 'data-state': etat === 'compatible' ? 'done' : (etat === 'juste' ? 'warning' : 'error') }),
                m('kml.etat.' + (etat === 'lourd' ? 'lourd' : etat))),
              ec !== null ? h('span', { className: 'kml-etat-sous' }, m('kml.en.charge', { go: String(ec).replace('.', ',') })) : null,
              h('span', { className: 'kml-bar', 'aria-hidden': 'true' },
                h('span', { className: 'kml-bar-fill', 'data-etat': etat, style: { width: ec === null ? '0%' : Math.min(100, Math.round(ec / (ramGo || 16) * 100)) + '%' } }))),
            h('span', { className: 'kml-mod-actions' }, actions))
        }

        const ollamaAbsent = machine === null ? null : machine.ollama.present !== true
        // The program is there but its server does not answer: the tile used to stay green and the list of models read as "none".
        const ollamaArrete = machine !== null && machine.ollama.present === true && machine.ollama.serveur === false
        const hfInvalide = hfResult !== null && hfResult.ok !== true
        const hfVerdict = hfResult !== null && hfResult.ok === true ? hfResult : null
        const hfHorsChamp = hfVerdict !== null && hfVerdict.enChargeGo !== null && budgetGo !== null && hfVerdict.enChargeGo > budgetGo
        const hfCours = job !== null && job.running === true && String(job.cible || '').indexOf('hf.co/') === 0

        const tuile = (legende, contenu, cle) => h('div', { className: 'kml-tuile', key: cle },
          h('span', { className: 'kml-tuile-legend' }, legende),
          h('span', { className: 'kml-tuile-valeur' }, contenu))

        return h('div', { className: 'kml-root', 'data-kml': 'panneau' },
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', width: '100%', marginBottom: 6 } }, (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-modeles-locaux' }) : null)),
          h('h2', { className: 'kml-titre' }, m('kml.page.titre')),
          h('p', { className: 'kml-soustitre' }, m('kml.soustitre')),
          h('div', { className: 'kml-tuiles' },
            machine === null
              ? tuile(m('kml.tuile.machine'),
                h('span', { className: 'kml-tuile-ligne' },
                  h('span', { className: 'kbm-dot', 'data-state': 'idle' }),
                  machineErreur === null ? 'détection…' : (m('kml.erreur') + sep() + machineErreur)), 'm')
              : tuile(m('kml.tuile.machine'),
                h('span', { className: 'kml-tuile-ligne' },
                  h('span', { className: 'kbm-dot', 'data-state': 'done' }),
                  h('b', null, (machine.chip || machine.arch) + (ramGo !== null ? ' · ' + ramGo + ' Go RAM' : '')),
                  h('button', { className: 'kbm-btn kbm-btn-sm kbm-btn-ghost', onClick: lancerScan, disabled: scan === 'encours',
                    title: m('kml.scan.bouton'), 'aria-label': scan === 'encours' ? m('kml.scan.encours') : m('kml.reverifier') },
                  scan === 'encours'
                    ? h('span', { className: 'kml-scan-btn' }, h('span', { className: 'kml-spin' }, Ic('refresh', 12)), ' ', m('kml.scan.encours'))
                    : h('span', { className: 'kml-scan-btn' }, Ic('refresh', 12), ' ', m('kml.scan.bouton')))), 'm'),
            tuile(m('kml.tuile.budget'),
              h('span', { className: 'kml-tuile-ligne' },
                h('b', null, budgetGo === null ? '—' : '≈ ' + budgetGo + ' Go'),
                h('span', { className: 'kml-tuile-note' }, m('kml.budget.note'))), 'b'),
            tuile(m('kml.tuile.moteur'),
              machine === null
                ? h('span', { className: 'kml-tuile-ligne' }, h('span', { className: 'kbm-dot', 'data-state': 'idle' }), '…')
                : h('span', { className: 'kml-tuile-ligne' },
                  h('span', { className: 'kbm-dot', 'data-state': (ollamaAbsent === true || ollamaArrete === true) ? 'warning' : 'done' }),
                  h('b', null, ollamaAbsent === true ? m('kml.ollama.absent') : 'Ollama ' + (machine.ollama.version || '')),
                  ollamaAbsent === true
                    ? h('span', { className: 'kml-tuile-note' }, m('kml.ollama.note'))
                    : h('span', { className: 'kml-tuile-note' }, ollamaArrete === true ? m('kml.ollama.arrete') : m('kml.moteur.port')),
                  ollamaAbsent === true && job !== null && job.cible === 'ollama' && job.running === true
                    ? h('span', { className: 'kml-prog-texte' }, 'brew install ollama — ' + (job.ligne || '…'))
                    : (ollamaAbsent === true
                      ? h('button', { className: 'kbm-btn kbm-btn-sm kbm-btn-outline', onClick: () => installer('ollama') }, Ic('download', 12), m('kml.installer.ollama'))
                      : null)), 'e')),
          scan === 'encours' && scanEtape !== null
            ? h('p', { className: 'kml-scan-result', 'data-etape': scanEtape, role: 'status' }, m('kml.scan.etape.' + scanEtape))
            : null,
          scan === 'fini' && scanNouveaux !== null
            ? h('p', { className: 'kml-scan-result', 'data-ok': scanNouveaux.length > 0, role: 'status' },
              scanNouveaux.length > 0
                ? m('kml.scan.nouveaux', { n: String(scanNouveaux.length), ids: scanNouveaux.map((x) => x.id).join(', ') })
                : m('kml.scan.aucun'))
            : null,
          scan === 'fini' && catBilan !== null
            ? h('p', { className: 'kml-scan-result', 'data-cat': catBilan.ok === true ? catBilan.online.state : 'hote', 'data-ok': catBilan.ok === true && catBilan.nouveaux.length > 0, role: 'status' },
              (() => {
                if (catBilan.ok !== true) return m('kml.cat.hote')
                const o = catBilan.online
                const quand = dateDe(catBilan.publishedAt)
                if (o.state === 'ok' && catBilan.nouveaux.length > 0) {
                  const tiennent = catBilan.nouveaux.filter((id) => { const x = CATALOGUE.find((y) => y.id === id); return x !== undefined && (ramGo === null || x.ramMin <= ramGo) }).length
                  return m('kml.cat.nouveaux', { n: String(catBilan.nouveaux.length), date: dateDe(catBilan.depuis), ids: catBilan.nouveaux.join(', ') }) +
                    (ramGo !== null ? ' ' + m('kml.cat.tiennent', { k: String(tiennent), ram: String(ramGo) }) : '')
                }
                if (o.state === 'ok') return m('kml.cat.aucun', { date: quand })
                if (o.state === 'offline') return m('kml.cat.horsligne', { date: quand })
                if (o.state === 'off') return m('kml.cat.off')
                if (o.state === 'refused' && o.reason === 'no-key') return m('kml.cat.nokey', { date: quand })
                return m('kml.cat.refuse', { raison: String(o.reason), date: quand })
              })())
            : null,
          // Where the list below comes from, always: a recommendation is only as good as its date.
          h('p', { className: 'kml-scan-source', 'data-source': kbCatalogueInfo.source, 'data-rev': catRev },
            kbCatalogueInfo.source === 'embarque'
              ? m('kml.cat.source.embarque')
              : m(kbCatalogueInfo.source === 'signed' ? 'kml.cat.source.signe' : 'kml.cat.source.livre', { date: dateDe(kbCatalogueInfo.publishedAt) })),
          erreur !== null ? h('p', { className: 'kml-erreur' }, erreur) : null,
          h('div', { className: 'kml-hf-tete' },
            h('button', { className: 'kbm-btn kbm-btn-sm kbm-btn-outline', onClick: () => setHfOuvre(!hfOuvre), 'aria-expanded': hfOuvre === true },
              m('kml.hf.ouvrir'), hfOuvre === true ? ' ▲' : ' ▼'),
            branchees.length > 0 ? h('span', { className: 'kbm-tag', 'data-tone': 'neutral' }, m('kml.branches.count', { n: branchees.length })) : null),
          hfOuvre === true
            ? h('div', { className: 'kml-hf' },
              h('p', { className: 'kml-hf-sous' }, m('kml.hf.titre')),
              h('div', { className: 'kml-hf-rangee' },
                h('span', { className: 'kbm-in-wrap kml-hf-saisie' },
                  h('span', { className: 'kbm-in-icon' }, Ic('link', 14)),
                  h('input', { id: 'kml-hf-url', className: 'kbm-in-input', type: 'url', placeholder: m('kml.hf.placeholder'), value: hfUrl,
                    onChange: (e) => setHfUrl(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') verifierHF() },
                    'aria-label': m('kml.hf.label') })),
                h('button', { className: 'kbm-btn kbm-btn-md kbm-btn-primary', disabled: hfUrl.trim() === '' || hfPhase === 'encours', onClick: verifierHF },
                  hfPhase === 'encours' ? m('kml.hf.verif.encours') : m('kml.hf.verifier'))),
              h('div', { className: 'kml-hf-ex' },
                m('kml.hf.exemple') + ' ',
                h('button', { className: 'kml-hf-ex-lien', onClick: () => { setHfUrl('https://huggingface.co/Qwen/Qwen2.5-7B-GGUF/blob/main/qwen2.5-7b-instruct-q4_k_m.gguf'); setHfPhase('idle'); setHfResult(null) } },
                  'hf.co/Qwen/Qwen2.5-7B-GGUF · Q4_K_M')),
              hfInvalide === true
                ? h('p', { className: 'kml-erreur' }, hfResult.verdict === 'lien' ? m('kml.hf.err.lien') : m('kml.hf.err.format'))
                : null,
              hfVerdict !== null
                ? h('div', { className: 'kml-hf-verdict' },
                  h('span', null, h('b', null, m('kml.hf.champ.lien')), ' hf.co/' + hfVerdict.org + '/' + hfVerdict.repo),
                  h('span', null, h('b', null, m('kml.hf.champ.format')), ' ', m('kml.hf.gguf')),
                  h('span', null, h('b', null, m('kml.hf.champ.quant')), ' ', hfVerdict.quant === null ? m('kml.etat.inconnu') : hfVerdict.quant),
                  h('span', null, h('b', null, m('kml.hf.champ.memoire')), ' ',
                    hfVerdict.poidsGo === null ? m('kml.etat.inconnu') : '≈ ' + String(hfVerdict.poidsGo).replace('.', ',') + ' Go · ' + m('kml.en.charge', { go: String(hfVerdict.enChargeGo).replace('.', ',') })),
                  h('span', null, h('b', null, m('kml.hf.champ.gpu')), ' ',
                    machine !== null && machine.platform === 'darwin' ? m('kml.hf.metal') : m('kml.hf.metal.cpu')),
                  hfHorsChamp === true
                    ? h('p', { className: 'kml-hf-avertis' }, m('kml.installer.hf.hors-champ'))
                    : null,
                  hfHorsChamp === true || hfCours === true
                    ? null
                    : h('button', { className: 'kbm-btn kbm-btn-md kbm-btn-primary', onClick: () => installer(hfVerdict.cible, true) }, Ic('download', 14), m('kml.hf.telecharger') + ' — ' + hfVerdict.cible),
                  hfCours === true
                    ? h('div', { className: 'kml-hf-cours' },
                      h('div', { className: 'kml-prog' }, h('div', { className: 'kml-prog-fill', style: { width: (job.pct === null ? 4 : job.pct) + '%' } })),
                      h('span', { className: 'kml-prog-texte' }, job.pct === null ? m('kml.en.cours') : job.pct + ' %' + (job.octets !== null ? ' · ' + job.octets.recu + ' / ' + job.octets.total : '')))
                    : null)
                : null)
            : null,
          h('div', { className: 'kml-outils' },
            h('span', { className: 'kml-section kml-section-inline' }, m('kml.section.selection')),
            ['tous', 'compatibles', 'reco', 'leger'].map((b) => h('button', {
              key: b, className: 'kbm-pill kbm-pill-interactive' + (budget === b ? ' kbm-pill-active' : ''), onClick: () => setBudget(b),
            }, m('kml.' + b)))),
          h('div', { className: 'kml-liste' }, visibles.map(rangeeDe)),
          h('div', { className: 'kml-section' }, m('kml.section')),
          branchees.length === 0
            ? h('p', { className: 'kml-vide' }, m('kml.vide'))
            : branchees.map((mod) => h('div', { className: 'kml-rangee', key: mod.id, 'data-kml-rangee': mod.id },
              h('span', { className: 'kbm-dot', 'data-state': 'done' }),
              h('span', { className: 'kml-rangee-init' }, String(mod.id).charAt(0).toUpperCase()),
              h('span', { className: 'kml-rangee-nom' }, mod.id),
              h('span', { className: 'kml-rangee-meta' },
                h('span', { className: 'kml-prog-texte' }, ROUTE_LOCALE + ' · Q4'),
                h(LigneContexte, { modele: mod, onContexte: (n) => majContexte(mod.id, n) }),
                h('span', { className: 'kbm-tag', 'data-tone': 'warning', title: m('kml.relance') }, '⟳'),
                writable === true
                  ? h('button', { className: 'kbm-btn kbm-btn-sm kbm-btn-ghost', title: 'Retirer de DSH', 'aria-label': 'Retirer ' + mod.id, onClick: () => debrancher(mod.id) }, Ic('trash', 13))
                  : null))))
      }

      // Brancher un modèle déjà tiré, hors du panneau : ce que l'assistant de premier lancement fait quand son
      // téléchargement est fini. Même profil que le bouton « Brancher » (kbBuildProfile), même canal (settings.mutate).
      /** @returns {Promise<{ok:true}|{ok:false,reason:string}>} reason est un code */
      const kbConnect = async (id) => {
        const mod = CATALOGUE.find((x) => x.id === id)
        if (mod === undefined) return { ok: false, reason: 'unknown_model' }
        const api = kbMApi()
        if (api === null || api.settings === null) return { ok: false, reason: 'unavailable' }
        try {
          const resp = await api.settings.describe()
          if (resp === null || resp === undefined || resp.ok !== true) return { ok: false, reason: 'unavailable' }
          if (resp.value.writable !== true) return { ok: false, reason: 'readonly' }
          const namespaces = Array.isArray(resp.value.namespaces) ? resp.value.namespaces : []
          const vue = namespaces.filter((n) => n.ns === KB_NS)[0]
          if (vue === undefined) return { ok: false, reason: 'unavailable' }
          const value = vue.value && typeof vue.value === 'object' ? vue.value : {}
          const providers = value.providers && typeof value.providers === 'object' ? value.providers : {}
          const existing = providers[ROUTE_LOCALE] && typeof providers[ROUTE_LOCALE] === 'object' ? providers[ROUTE_LOCALE] : null
          const done = await api.settings.mutate(KB_NS, [{ op: 'set', path: ['providers', ROUTE_LOCALE], value: kbBuildProfile(existing, mod) }], typeof vue.revision === 'number' ? vue.revision : undefined)
          return done !== null && done !== undefined && done.ok === true ? { ok: true } : { ok: false, reason: 'write_refused' }
        } catch (e) { return { ok: false, reason: 'refused' } }
      }

      return {
        inject: ['slots', 'remote', 'remote.settings', 'remote.llm', 'locale'],
        apply(ctx) {
          kbCtx = ctx
          // The first-run wizard (kybernos-plugin) asks for the recommendation and connects a pulled model through this.
          ctx.effect(() => {
            const seam = {
              recommend: (ramGo) => { const r = kbRecommend(ramGo); return r === null ? null : { id: r.id, tailleGo: r.tailleGo, ramMin: r.ramMin } },
              connect: kbConnect,
            }
            try { window.__KB_LOCAL__ = seam } catch (e) { /* no window */ }
            return () => { try { if (window.__KB_LOCAL__ === seam) delete window.__KB_LOCAL__ } catch (e) { /* no window */ } }
          }, 'modeles-locaux: wizard seam')
          try {
            const svc = ctx.get('locale')
            const lu = typeof svc === 'string' ? svc : (svc !== null && svc !== undefined ? (svc.locale || svc.current || svc.lang) : null)
            kbLocaleRead = () => (lu !== null && lu !== undefined && String(lu).toLowerCase().indexOf('fr') === 0) || String(document.documentElement.lang || '').toLowerCase().indexOf('fr') === 0 ? 'fr' : 'en'
          } catch (e) { kbLocaleRead = () => 'en' }
          styles.insert(KBM_CSS, '@local/kybernos-modeles-locaux')
          styles.insert(KML_CSS, '@local/kybernos-modeles-locaux')
          // (02/10) Une seule porte : la section dédiée ci-dessous. Le pied de la
          // page Models native et la monture de « AI Provider & Models » sont retirés.
          // ── Section Réglages DÉDIÉE ────────────────────────────────────────
          // Même composant Panel, siège à lui dans la navigation des Réglages.
          ctx.effect(() => {
            const slots2 = ctx.get('slots')
            if (slots2 === undefined || slots2 === null) return undefined
            return slots2.inject('settings.section', () => slots2.register(
              { name: 'settings.section', id: 'kybernos-ollama', order: 28, label: m('kml.page.titre') },
              Panel))
          }, 'modeles-locaux: section Réglages dédiée')
          // (02/10) La monture dans la page « AI Provider & Models » est retirée :
          // le panneau n'existe plus que dans la section dédiée ci-dessus.
        },
      }
    } catch (bootError) {
      try { console.error('[kybernos-modeles-locaux] chargement impossible — plugin désactivé, GUI préservée', bootError) } catch (e2) { /* console indisponible */ }
      return { apply() { /* plugin désactivé après erreur de chargement */ } }
    }
  },
})
