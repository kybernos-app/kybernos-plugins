// kybernos-language — moitié navigateur (plugin séparé, débranchable).
//
// Le bloc « Langue » était dans @local/kybernos-theme : il en sort pour vivre
// dans SON bundle, activable/désactivable seul. Ce plugin porte :
//
//   section Paramètres « Language » ........ settings.section (order 2)
//   liste des langues + ajout ............. langue source, built-in, traduction IA
//   moteur de traduction (LLM) ............ route hôte /kybernos/i18n-translate
//   direction et langue du document ....... dir + lang sur <html>
//
// Le pont `kbt()`/`kbf()` de @local/kybernos lit `window.__KB_I18N_ACTIVE__` :
// il est posé ici dès l'activation, AVANT le rendu des autres entrées.
//
// Chargé via window.__ModuleLoader__.load — même forme que les paquets ui-*.
// Le try/catch de la factory est vital : une erreur d'évaluation ici casse TOUTE
// l'entrée (« Failed to load plugins ») et laisse la GUI inutilisable. On
// dégrade : plugin désactivé, GUI préservée.
window.__ModuleLoader__.load({
  id: '@local/kybernos-language',
  factory(require) {
    try {

      const React = require('react')
      const h = React.createElement

      // `styles` suit le contrat du runner cordis dynamique : insert(css)
      // retourne un disposer.
      const styles = (() => {
        const insert = (css) => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/kybernos-language'
          tag.textContent = css
          document.head.append(tag)
          return () => { tag.remove() }
        }
        return { insert }
      })()

      // ══════════════════════════════════════════════════════════════════════
      // 1. FEUILLE DE STYLE — section Langue, modale de traduction, RTL.
      // ══════════════════════════════════════════════════════════════════════

      const css = `
/* ── Gabarit de page (repris de kybernos-theme, PAS emprunté) ───────────────
   Ce bundle est un satellite DÉBRANCHABLE : kybernos-theme peut disparaître du
   profil sans que cette page perde sa mise en page. Les règles ci-dessous sont
   donc DUPLIQUÉES ici plutôt que partagées — c'est le prix, assumé, d'un
   satellite qui tient debout tout seul. Mêmes valeurs, mêmes jetons DSH. */
[data-slot="settings.section"]:has(.kbth-page) { width: 100%; max-width: none; }
.kbth-page{display:grid;grid-template-columns:1fr;gap:22px;max-width:720px;align-items:start}
.kbth-main{display:flex;flex-direction:column;gap:22px;min-width:0}
.kbth-head{display:flex;flex-direction:column;gap:6px}
.kbth-title{font-size:26px;line-height:32px;font-weight:800;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}
.kbth-sub{font-size:14px;line-height:1.55;color:var(--dsw-alias-label-secondary);max-width:640px}
.kbth-sec{display:flex;flex-direction:column;gap:12px}
.kbth-sec-h{display:flex;flex-direction:column;gap:3px}
.kbth-sec-t{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbth-sec-d{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.kbth-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.kbth-lb{font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary);width:130px;flex:none}
.kbth-hint{font-size:11px;color:var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary));line-height:1.45}
.kbth-btn{appearance:none;font:inherit;font-size:12px;padding:5px 11px;border-radius:8px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);transition:background .12s,border-color .12s}
.kbth-btn:hover{background:var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-3));border-color:var(--dsw-alias-border-l3)}
.kbth-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.kbth-pill{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}
/* ── Section Langue ─────────────────────────────────────────────────────── */
.kbth-lang-list{display:flex;flex-direction:column;gap:6px}
.kbth-lang-item{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:border-color .12s,box-shadow .12s}
.kbth-lang-item:hover:not([aria-pressed="true"]){border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}
.kbth-lang-item[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.kbth-lang-flag{font-size:18px;flex:none;width:28px;text-align:center}
.kbth-lang-info{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.kbth-lang-name{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbth-lang-meta{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.kbth-lang-check{width:18px;height:18px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l3);flex:none;display:flex;align-items:center;justify-content:center}
.kbth-lang-item[aria-pressed="true"] .kbth-lang-check{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:#fff}
.kbth-lang-add{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;border:.5px dashed var(--dsw-alias-border-l3);background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:13px;transition:border-color .12s,color .12s}
.kbth-lang-add:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.kbth-select{appearance:none;font:inherit;font-size:13px;padding:6px 28px 6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2381858c'/%3E%3C/svg%3E") no-repeat right 10px center;color:var(--dsw-alias-label-primary);cursor:pointer;min-width:200px}
.kbth-select:focus{border-color:var(--dsw-alias-brand-primary);outline:none}
/* ── Modale de traduction ──────────────────────────────────────────────── */
.kbth-modal-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;animation:kbth-fade-in .15s ease-out}
@keyframes kbth-fade-in{from{opacity:0}to{opacity:1}}
.kbth-modal{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:16px;padding:24px;width:420px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,.25);animation:kbth-slide-up .2s ease-out}
@keyframes kbth-slide-up{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}
.kbth-modal-title{font-size:17px;font-weight:700;color:var(--dsw-alias-label-primary);margin-bottom:4px}
.kbth-modal-sub{font-size:13px;color:var(--dsw-alias-label-tertiary);margin-bottom:18px}
.kbth-progress-track{height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden;margin-bottom:8px}
.kbth-progress-fill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .3s ease}
.kbth-progress-text{font-size:12px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;margin-bottom:18px;text-align:center}
.kbth-modal-actions{display:flex;gap:8px;justify-content:flex-end}
.kbth-modal-btn{appearance:none;font:inherit;font-size:13px;font-weight:500;padding:7px 16px;border-radius:9px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);transition:background .12s,border-color .12s}
.kbth-modal-btn:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-3));border-color:var(--dsw-alias-border-l3)}
.kbth-modal-btn.primary{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:var(--dsw-alias-brand-primary)}
.kbth-modal-btn.primary:hover{opacity:.9}
.kbth-lang-input-row{display:flex;gap:8px;margin-bottom:12px}
.kbth-lang-input{flex:1;appearance:none;font:inherit;font-size:13px;padding:7px 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);outline:none;transition:border-color .12s}
.kbth-lang-input:focus{border-color:var(--dsw-alias-brand-primary)}
/* ── RTL-ready (chantier traduction arabe) ──────────────────────────────────
   Le sens de lecture vit sur <html dir> : les rangées flex et le texte suivent
   tout seuls. Ces correctifs ne touchent que ce qui est écrit en propriétés
   physiques (left/right), que le navigateur ne retourne pas. */
html[dir="rtl"] .kbth-select{background-position:left 10px center;padding:6px 10px 6px 28px}
html[dir="rtl"] .kbth-slider{background:linear-gradient(to left,var(--dsw-alias-brand-primary) 0 var(--fill,50%),var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-3)) var(--fill,50%) 100%)}
html[dir="rtl"] .kbth-lang-check{margin-inline-start:auto}
/* Chiffres, mesures et code restent lus gauche-à-droite dans une interface
   droite-à-gauche (usage bidi standard) : */
html[dir="rtl"] .kbth-sl-vl,html[dir="rtl"] .kbth-fsmeta,html[dir="rtl"] .kbth-progress-text,
html[dir="rtl"] code,html[dir="rtl"] pre{direction:ltr;unicode-bidi:isolate;text-align:left}
/* Panneau de réglages : la page reste à sa place, seul le flux interne s'inverse. */
html[dir="rtl"] .kbth-page{direction:rtl}
`

      // ══════════════════════════════════════════════════════════════════════
      // 5b. SYSTÈME DE TRADUCTION — traduction à la demande via LLM.
      //     KB_T est lu depuis le plugin principal (window.__KB_T__ ou fetch
      //     du source). Les traductions sont cachées dans localStorage sous
      //     kybernos.i18n.<lang>. Le moteur traduit par lots de 15 clés.
      // ══════════════════════════════════════════════════════════════════════

      const I18N_STORE_PREFIX = 'kybernos.i18n.'
      // RTL-ready : une langue se déclare droite-à-gauche ici (et toute langue
      // ajoutée plus tard dont l'id est dans la liste hérite du sens). Le sens
      // est posé sur <html> (dir + lang) par appliquerDirection(), pas sur un
      // conteneur : c'est ce que lisent la cascade CSS et les lecteurs d'écran.
      const RTL_LANGS = ['ar', 'he', 'fa', 'ur']
      const isRtlLang = (id) => RTL_LANGS.indexOf(String(id || '').split(/[-_]/)[0]) >= 0
      const KNOWN_LANGS = [
        { id: 'kybernos', label: 'Français', flag: '🇫🇷' },
        { id: 'en', label: 'English', flag: '🇬🇧' },
        { id: 'ar', label: 'العربية', flag: '🇸🇦' },
      ]

      // Lire les traductions cachées pour une langue donnée.
      const i18nRead = (lang) => {
        try {
          const raw = localStorage.getItem(I18N_STORE_PREFIX + lang)
          if (raw === null) return {}
          return JSON.parse(raw)
        } catch (e) { return {} }
      }
      const i18nWrite = (lang, dict) => {
        try { localStorage.setItem(I18N_STORE_PREFIX + lang, JSON.stringify(dict)) } catch (e) { /* quota */ }
      }

      // Liste des langues disponibles (built-in + cachées).
      const getAvailableLangs = () => {
        const langs = [...KNOWN_LANGS]
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key !== null && key.indexOf(I18N_STORE_PREFIX) === 0) {
              const lid = key.slice(I18N_STORE_PREFIX.length)
              if (lid.length > 0 && /^[a-z]{2,3}(-[A-Za-z0-9]+)?$/i.test(lid) && langs.every((l) => l.id !== lid)) {
                langs.push({ id: lid, label: lid.charAt(0).toUpperCase() + lid.slice(1), flag: '🌐' })
              }
            }
          }
        } catch (e) { /* localStorage indisponible */ }
        return langs
      }

      // Extraire KB_T du plugin principal. Essaie window.__KB_T__ d'abord,
      // puis fetch du source et extraction par regex.
      let _kbTCache = null
      const extractKBT = async () => {
        if (_kbTCache !== null) return _kbTCache
        // 1. Global exposé par le plugin principal (si ajouté)
        if (typeof window !== 'undefined' && window.__KB_T__ !== undefined && window.__KB_T__ !== null) {
          _kbTCache = window.__KB_T__
          return _kbTCache
        }
        // 2. Fetch du source du plugin principal et extraction.
        //    Mesuré le 25/09 : le client n'est PAS servi comme
        //    `/kybernos-plugin/client.js` (404) mais dans une URL GROUPÉE de
        //    plugins `/plugins/??@local/kybernos/client.js,…&rev=…` — visible
        //    dans `performance.getEntriesByType('resource')`. On essaie les
        //    candidats dans l'ordre : le premier qui contient KB_T gagne.
        try {
          const candidats = []
          for (const s of Array.from(document.querySelectorAll('script[src]'))) {
            if (s.src && (s.src.indexOf('@local/kybernos/client.js') >= 0 || s.src.indexOf('kybernos-plugin') >= 0) && s.src.indexOf('client') >= 0) candidats.push(s.src)
          }
          try {
            for (const eRes of performance.getEntriesByType('resource')) {
              if (eRes.name && eRes.name.indexOf('@local/kybernos/client.js') >= 0 && candidats.indexOf(eRes.name) < 0) candidats.push(eRes.name)
            }
          } catch (e0) { /* performance indisponible */ }
          candidats.push('/plugins/??@local/kybernos/client.js', '/kybernos-plugin/client.js')
          for (const src of candidats) {
            let text = null
            try {
              const res = await fetch(src, { cache: 'force-cache' })
              if (res.ok) text = await res.text()
            } catch (eF) { /* candidat injoignable : suivant */ }
            if (text === null) continue
            // Extraire le bloc KB_T = { ... }
            const match = /const\s+KB_T\s*=\s*(\{[\s\S]*?\n\s*\})/.exec(text)
            if (match === null) continue
            // Évaluer le littéral objet de manière sûre
            try {
              // eslint-disable-next-line no-new-func
              const parsed = new Function('return (' + match[1] + ')')()
              if (parsed !== null && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                // Merge des phrases « kbf » (traduction de profondeur) : la
                // table KB_FR_EN porte des PHRASES françaises en clés. Elles
                // partent dans le lot traduit (clé = phrase, source = elle-
                // même) pour que kbf les rende dans la langue cible aussi.
                try {
                  const m2 = /const\s+KB_FR_EN\s*=\s*(\{[\s\S]*?\n\})/.exec(text)
                  if (m2 !== null) {
                    // eslint-disable-next-line no-new-func
                    const frEn = new Function('return (' + m2[1] + ')')()
                    if (frEn !== null && typeof frEn === 'object') {
                      for (const phrase of Object.keys(frEn)) {
                        if (typeof phrase === 'string' && phrase.length > 0 && parsed[phrase] === undefined) parsed[phrase] = { kybernos: phrase }
                      }
                    }
                  }
                } catch (e2) { /* KB_FR_EN absent : KB_T seul suffit */ }
                _kbTCache = parsed
                return _kbTCache
              }
            } catch (e) { /* parsing échoué : candidat suivant */ }
          }
        } catch (e) { /* fetch échoué */ }
        // 3. Fallback : dictionnaire vide
        _kbTCache = {}
        return _kbTCache
      }

      // ── Providers LLM configurés dans DSH ────────────────────────────────
      // Lit settings.yaml via le host remote pour découvrir les providers et
      // leurs modèles. Cache le résultat pour éviter les appels répétés.
      let _providersCache = null
      const fetchProviders = async (ctxRef) => {
        if (_providersCache !== null) return _providersCache
        try {
          // Le host expose les settings via ctx.remote ou via le DOM
          // Méthode 1 : lire depuis window.__DSH_BOOT__ si disponible
          // Méthode 2 : fetch vers le host via le remote cordis
          // Méthode 3 : fallback — lire depuis le DOM (le sélecteur de modèle DSH)
          const modelSelects = document.querySelectorAll('select[class*="model"], [data-model-select]')
          // Méthode pragmatique : lire les providers depuis settings.yaml via fetch
          // DSH sert les settings via son API interne — mais on n'a pas d'endpoint REST.
          // On utilise donc le remote cordis si disponible.
          if (ctxRef !== null && ctxRef !== undefined && ctxRef.remote !== null && ctxRef.remote !== undefined) {
            try {
              // Le remote expose peut-être un service de settings
              const settingsSvc = ctxRef.get ? ctxRef.get('settings') : null
              if (settingsSvc !== null && settingsSvc !== undefined && typeof settingsSvc.read === 'function') {
                const cfg = await settingsSvc.read('llm-pi-ai')
                if (cfg !== null && cfg !== undefined && cfg.providers !== null) {
                  _providersCache = []
                  for (const [provId, provCfg] of Object.entries(cfg.providers)) {
                    const models = Array.isArray(provCfg.models) ? provCfg.models : []
                    for (const m of models) {
                      _providersCache.push({
                        id: provId + '/' + m.id,
                        provider: provId,
                        model: m.id,
                        name: m.name || m.id,
                        baseURL: provCfg.baseURL || null,
                        apiKeyEnv: provCfg.apiKeyEnv || null,
                        api: provCfg.api || 'openai-completions'
                      })
                    }
                  }
                  return _providersCache
                }
              }
            } catch (e) { /* remote indisponible */ }
          }
        } catch (e) { /* erreur lecture */ }
        // Fallback : liste de providers connus (l'utilisateur configure la clé API au premier usage)
        _providersCache = [
          { id: 'ollama-cloud/deepseek-v4.1-flash', provider: 'ollama-cloud', model: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', baseURL: 'https://ollama.com/v1', apiKeyEnv: 'OLLAMA_CLOUD_API_KEY', api: 'openai-completions' },
          { id: 'ollama-cloud/glm-5.3-flash', provider: 'ollama-cloud', model: 'glm-5.3-flash', name: 'GLM-5.3 Flash', baseURL: 'https://ollama.com/v1', apiKeyEnv: 'OLLAMA_CLOUD_API_KEY', api: 'openai-completions' },
          { id: 'ollama-cloud/kimi-k3', provider: 'ollama-cloud', model: 'kimi-k3', name: 'Kimi K3', baseURL: 'https://ollama.com/v1', apiKeyEnv: 'OLLAMA_CLOUD_API_KEY', api: 'openai-completions' },
          { id: 'groq/llama-3.3-70b-versatile', provider: 'groq', model: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', baseURL: 'https://api.groq.com/openai/v1', apiKeyEnv: 'GROQ_API_KEY', api: 'openai-completions' },
          { id: 'groq/llama-3.1-8b-instant', provider: 'groq', model: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', baseURL: 'https://api.groq.com/openai/v1', apiKeyEnv: 'GROQ_API_KEY', api: 'openai-completions' },
          { id: 'deepseek/deepseek-chat', provider: 'deepseek', model: 'deepseek-chat', name: 'DeepSeek Chat', baseURL: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', api: 'openai-completions' },
          { id: 'openai/gpt-4o-mini', provider: 'openai', model: 'gpt-4o-mini', name: 'GPT-4o Mini', baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', api: 'openai-completions' },
          { id: 'dashscope/qwen-plus', provider: 'dashscope', model: 'qwen-plus', name: 'Qwen Plus', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKeyEnv: 'DASHSCOPE_API_KEY', api: 'openai-completions' },
        ]
        return _providersCache
      }

      // Appeler directement l'API du provider (OpenAI-compat) pour traduire.
      const translateBatch = async (keys, sourceDict, targetLang, providerInfo) => {
        const entries = keys.map((k) => ({ key: k, fr: (sourceDict[k] || {}).kybernos || k }))
        // ── Chemin hôte d'abord (chantier RTL/arabe) : POST /kybernos/i18n-translate
        // L'appel navigateur→provider était bloqué par CORS et sans clé (la clé
        // vit dans l'env de l'hôte) : la traduction retombait en français sans
        // rien dire. L'hôte résout le modèle et la clé ; on ne garde le chemin
        // direct que si la route hôte n'existe pas (profil plus ancien).
        try {
          const res = await fetch('/kybernos/i18n-translate', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              lang: targetLang,
              provider: providerInfo !== null && providerInfo !== undefined ? providerInfo.provider : undefined,
              model: providerInfo !== null && providerInfo !== undefined ? providerInfo.model : undefined,
              batch: Object.fromEntries(entries.map((e) => [e.key, e.fr])),
            }),
          })
          if (res.ok) {
            const json = await res.json()
            if (json !== null && typeof json === 'object' && json.ok === true && json.translations !== null && typeof json.translations === 'object') {
              return json.translations
            }
          }
        } catch (e) { /* route hôte absente ou injoignable : chemin direct */ }

        const prompt = 'Tu es un traducteur professionnel. Traduis les chaînes suivantes du français vers '
          + targetLang + '. Réponds UNIQUEMENT avec un objet JSON où chaque clé est la clé originale '
          + 'et chaque valeur est la traduction. Aucune explication, aucun markdown.\n\n'
          + JSON.stringify(Object.fromEntries(entries.map((e) => [e.key, e.fr])))

        if (providerInfo === null || providerInfo === undefined) {
          // Échec honnête : rien n'est caché, les clés restent à traduire —
          // renvoyer le français ici l'aurait enregistré comme « traduction ».
          return {}
        }

        try {
          // Déterminer l'URL de l'API
          let apiBase = providerInfo.baseURL
          if (apiBase === null || apiBase === undefined) {
            // Providers connus — mapping vers leurs endpoints OpenAI-compat
            const KNOWN_ENDPOINTS = {
              'ollama-cloud': 'https://ollama.com/v1',
              'groq': 'https://api.groq.com/openai/v1',
              'openrouter': 'https://openrouter.ai/api/v1',
              'zai-coding-cn': 'https://open.bigmodel.cn/api/paas/v4',
              'dashscope': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
              'deepseek': 'https://api.deepseek.com/v1',
              'openai': 'https://api.openai.com/v1',
              'anthropic': 'https://api.anthropic.com/v1'
            }
            apiBase = KNOWN_ENDPOINTS[providerInfo.provider] || null
          }
          if (apiBase === null) return {}

          // Lire la clé API depuis l'environnement (via le host) ou localStorage
          let apiKey = ''
          try {
            // Essayer de lire depuis localStorage (l'utilisateur peut l'avoir configurée)
            const stored = localStorage.getItem('kybernos.i18n.apikey.' + providerInfo.provider)
            if (stored !== null) apiKey = stored
          } catch (e) { /* localStorage indisponible */ }

          const res = await fetch(apiBase + '/chat/completions', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(apiKey ? { 'authorization': 'Bearer ' + apiKey } : {})
            },
            body: JSON.stringify({
              model: providerInfo.model,
              messages: [{ role: 'user', content: prompt }],
              stream: false,
              temperature: 0.3,
            }),
          })
          if (res.ok) {
            const json = await res.json()
            const content = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || ''
            const jsonMatch = /\{[\s\S]*\}/.exec(content)
            if (jsonMatch !== null) {
              try { return JSON.parse(jsonMatch[0]) } catch (e) { /* parse échoué */ }
            }
          } else {
            // Si 401, proposer à l'utilisateur de configurer la clé
            if (res.status === 401) {
              const key = prompt('Clé API pour ' + providerInfo.provider + ' (sera stockée localement) :')
              if (key !== null && key.length > 0) {
                try { localStorage.setItem('kybernos.i18n.apikey.' + providerInfo.provider, key) } catch (e) { /* */ }
                // Réessayer avec la nouvelle clé
                const res2 = await fetch(apiBase + '/chat/completions', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + key },
                  body: JSON.stringify({ model: providerInfo.model, messages: [{ role: 'user', content: prompt }], stream: false, temperature: 0.3 }),
                })
                if (res2.ok) {
                  const json2 = await res2.json()
                  const content2 = (json2.choices && json2.choices[0] && json2.choices[0].message && json2.choices[0].message.content) || ''
                  const jsonMatch2 = /\{[\s\S]*\}/.exec(content2)
                  if (jsonMatch2 !== null) { try { return JSON.parse(jsonMatch2[0]) } catch (e) { /* */ } }
                }
              }
            }
          }
        } catch (e) { /* API indisponible */ }

        // Toute la voie directe a échoué : lot vide (les clés restent « à
        // traduire », un prochain essai relance le moteur).
        return {}
      }

      // Moteur de traduction complet avec progression.
      const runTranslation = async (targetLang, onProgress, onCancel, providerInfo) => {
        const kbT = await extractKBT()
        const allKeys = Object.keys(kbT)
        if (allKeys.length === 0) return { ok: false, error: 'Aucune clé à traduire' }

        const existing = i18nRead(targetLang)
        const missing = allKeys.filter((k) => existing[k] === undefined)
        if (missing.length === 0) return { ok: true, cached: true, total: allKeys.length }

        // 40 = le plafond de la route hôte /kybernos/i18n-translate : 1771
        // chaînes en ~45 appels au lieu de 118 (les lots de 15 dataient de la
        // voie navigateur→provider, où chaque appel risquait le CORS).
        const BATCH_SIZE = 40
        // Les lots sont AUSSI bornés en caractères : la sortie attendue croît
        // avec la source, et un JSON tronqué est rejeté entier. 2 600 caractères
        // de source tiennent dans 4 000 tokens de sortie, même sur un hôte qui
        // n'a pas le budget adaptatif.
        const CHAR_BUDGET = 2600
        const lots = []
        let cur = [], curLen = 0
        for (const k of missing) {
          const len = String((kbT[k] || {}).kybernos || k).length
          if (cur.length >= BATCH_SIZE || (cur.length > 0 && curLen + len > CHAR_BUDGET)) { lots.push(cur); cur = []; curLen = 0 }
          cur.push(k); curLen += len
        }
        if (cur.length > 0) lots.push(cur)
        const translated = { ...existing }
        let done = allKeys.length - missing.length
        const total = allKeys.length

        for (const batch of lots) {
          if (onCancel && onCancel()) return { ok: false, cancelled: true, done, total }
          const result = await translateBatch(batch, kbT, targetLang, providerInfo)
          for (const k of batch) {
            if (result[k] !== undefined) translated[k] = result[k]
          }
          done += batch.length
          if (onProgress) onProgress(done, total)
          i18nWrite(targetLang, translated)
        }

        return { ok: true, total, translated: done }
      }

      // RTL-ready : pose le sens de lecture et la langue sur <html>. Idempotent
      // — appelé au boot (rechargement) et à chaque changement de langue, pour
      // que la cascade CSS (`html[dir="rtl"]`) et l'API Platform suivent.
      const appliquerDirection = (lang) => {
        try {
          const rtl = isRtlLang(lang)
          const doc = document.documentElement
          doc.setAttribute('dir', rtl ? 'rtl' : 'ltr')
          doc.setAttribute('lang', lang === 'kybernos' ? 'fr' : String(lang))
        } catch (e) { /* document indisponible (rendu hors navigateur) */ }
      }

      // Gardien de `lang` : le shell DSH (dsh-client-locale) pose AUSSI lang
      // sur <html>, après le boot — mesuré le 25/09, il écrase 'ar' par la
      // locale du shell ('en'). Tant qu'une langue Kybernos non-natique est
      // active, on reprend la main ; pour 'kybernos' on rend la main au shell.
      let _langGardien = null
      const surveillerLang = () => {
        if (typeof MutationObserver === 'undefined') return
        const actif = (typeof window !== 'undefined' && window.__KB_I18N_ACTIVE__ ? window.__KB_I18N_ACTIVE__.lang : null) || 'kybernos'
        if (actif === 'kybernos' || actif === 'en') {
          if (_langGardien !== null) { try { _langGardien.disconnect() } catch (e) { /* */ } _langGardien = null }
          return
        }
        if (_langGardien !== null) return
        _langGardien = new MutationObserver(() => {
          const courant = (window.__KB_I18N_ACTIVE__ || {}).lang || 'kybernos'
          const attendu = courant === 'kybernos' ? 'fr' : String(courant)
          if (document.documentElement.getAttribute('lang') !== attendu) {
            document.documentElement.setAttribute('lang', attendu)
          }
        })
        _langGardien.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
      }

      // Appliquer la langue active : expose les traductions sur window pour
      // que le plugin principal puisse les lire si besoin.
      const applyLanguage = (lang) => {
        try {
          const dict = i18nRead(lang)
          window.__KB_I18N_ACTIVE__ = { lang, dict, rtl: isRtlLang(lang) }
          appliquerDirection(lang)
          surveillerLang()
          // Notifier le changement via un événement custom
          window.dispatchEvent(new CustomEvent('kybernos-lang-change', { detail: { lang, dict, rtl: isRtlLang(lang) } }))
        } catch (e) { /* silencieux */ }
      }

      // Lire la langue active courante
      const readActiveLang = () => {
        try {
          const raw = localStorage.getItem('kybernos.theme.lang')
          if (raw !== null) return raw
        } catch (e) { /* fallback */ }
        // (01/10) Sans choix Kybernos explicite, suivre le shell quand il parle
        // anglais : l'utilisateur qui règle DSH en English doit lire des onglets
        // anglais, pas la maquette française par défaut (KB_T est bilingue
        // complet). Toute autre locale non servie retombe sur « kybernos ».
        try {
          const loc = String(document.documentElement.getAttribute('lang') || '').split(/[-_]/)[0].toLowerCase()
          if (loc === 'en') return 'en'
        } catch (e2) { /* document indisponible */ }
        return 'kybernos'
      }
      const writeActiveLang = (lang) => {
        try { localStorage.setItem('kybernos.theme.lang', lang) } catch (e) { /* quota */ }
      }


      // ══════════════════════════════════════════════════════════════════════
      // 2. LA PAGE — une seule section : choisir la langue, en ajouter une.
      // ══════════════════════════════════════════════════════════════════════

      function Page(props) {
        const ctxRef = props.ctx
        // ── État traduction ────────────────────────────────────────────────
        const [activeLang, setActiveLang] = React.useState(readActiveLang())
        const [translateModal, setTranslateModal] = React.useState(null) // { lang, label }
        const [translateProgress, setTranslateProgress] = React.useState({ done: 0, total: 0 })
        const [translateRunning, setTranslateRunning] = React.useState(false)
        const [translateCancelled, setTranslateCancelled] = React.useState(false)
        // Un moteur qui échoue (source KB_T introuvable, route hôte absente…
        // `{ ok:false }`) doit se LIRE : sans état dédié, la modale restait
        // bloquée sur « Préparation… » sans jamais dire pourquoi (mesuré).
        const [translateErreur, setTranslateErreur] = React.useState(null)
        const [addLangOpen, setAddLangOpen] = React.useState(false)
        const [newLangId, setNewLangId] = React.useState('')
        const translateCancelRef = React.useRef(false)
        // Sélecteur de modèle LLM pour la traduction
        const [providers, setProviders] = React.useState([])
        const [selectedProvider, setSelectedProvider] = React.useState(() => {
          try { return localStorage.getItem('kybernos.i18n.provider') || '' } catch (e) { return '' }
        })
        React.useEffect(() => {
          fetchProviders(ctxRef).then((list) => {
            setProviders(list)
            // Si aucun provider sélectionné, prendre le premier disponible
            if (selectedProvider === '' && list.length > 0) {
              setSelectedProvider(list[0].id)
              try { localStorage.setItem('kybernos.i18n.provider', list[0].id) } catch (e) { /* */ }
            }
          })
        }, [])

        // Appliquer la langue au montage
        React.useEffect(() => { applyLanguage(activeLang) }, [activeLang])

        // ── Simple : langue ────────────────────────────────────────────────
        const availableLangs = getAvailableLangs()
        // Activer une langue = mémoriser + exposer + RECHARGER : les écrans
        // (plugin principal compris) lisent la langue à leur rendu, et aucun
        // signal de re-rendu global n'existe — le rechargement applique la
        // direction (rtl) et les traductions (déjà cachées) partout, tout de suite.
        const activerLangue = (langId) => {
          writeActiveLang(langId)
          setActiveLang(langId)
          applyLanguage(langId)
          window.setTimeout(() => { try { location.reload() } catch (e) { /* silencieux */ } }, 300)
        }
        const startTranslation = (langId, langLabel) => {
          translateCancelRef.current = false
          setTranslateCancelled(false)
          setTranslateErreur(null)
          setTranslateModal({ lang: langId, label: langLabel })
          setTranslateProgress({ done: 0, total: 0 })
          setTranslateRunning(true)
          // Trouver le provider sélectionné
          const prov = providers.find((p) => p.id === selectedProvider) || null
          runTranslation(
            langId,
            (done, total) => setTranslateProgress({ done, total }),
            () => translateCancelRef.current,
            prov,
          ).then((result) => {
            setTranslateRunning(false)
            if (result.ok && !result.cancelled) {
              setTranslateModal(null)
              activerLangue(langId)
            } else if (result.cancelled) {
              setTranslateCancelled(true)
            } else {
              // Échec du moteur : la modale reste ouverte POUR LE DIRE —
              // l'utilisateur referme, rien n'est activé, rien n'est caché.
              setTranslateErreur(result.error || 'échec inconnu')
            }
          }).catch((e) => {
            setTranslateRunning(false)
            setTranslateErreur(String((e !== null && e !== undefined && e.message) || e))
          })
        }
        const handleLangSelect = (langId) => {
          const cached = i18nRead(langId)
          // « Connue » ne veut pas dire « traduite » : seuls kybernos (source)
          // et en (intégrée à KB_T) s'activent sans moteur. Une langue connue
          // sans dict (premier choix d'ar) passe par la traduction.
          const hasCached = Object.keys(cached).length > 0 || langId === 'kybernos' || langId === 'en'
          if (hasCached) {
            activerLangue(langId)
          } else {
            const langInfo = availableLangs.find((l) => l.id === langId) || { label: langId }
            startTranslation(langId, langInfo.label)
          }
        }
        const handleAddLang = () => {
          const lid = newLangId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
          if (lid.length < 2) return
          setAddLangOpen(false)
          setNewLangId('')
          startTranslation(lid, lid.charAt(0).toUpperCase() + lid.slice(1))
        }

        const langue = h('div', { className: 'kbth-sec' },
          // Pas d'intertitre ici : le titre de page (.kbth-title) porte déjà
          // « Langue » et sa phrase — la maquette ne les répète pas.
          h('div', { className: 'kbth-lang-list' },
            availableLangs.map((lang) => h('button', {
              key: lang.id, type: 'button', className: 'kbth-lang-item',
              'aria-pressed': activeLang === lang.id ? 'true' : 'false',
              onClick: () => handleLangSelect(lang.id),
            },
              h('span', { className: 'kbth-lang-flag' }, lang.flag),
              h('div', { className: 'kbth-lang-info' },
                h('span', { className: 'kbth-lang-name' }, lang.label),
                h('span', { className: 'kbth-lang-meta' },
                  lang.id === 'kybernos' ? 'Langue source' :
                  lang.id === 'en' ? 'Built-in' :
                  'Traduction IA' + (isRtlLang(lang.id) ? ' · droite-à-gauche' : ''))),
              h('div', { className: 'kbth-lang-check' },
                activeLang === lang.id ? '✓' : null)))),
          addLangOpen
            ? h('div', { className: 'kbth-lang-input-row' },
                h('input', {
                  className: 'kbth-lang-input', type: 'text', placeholder: 'Code langue (ex: es, de, ja…)',
                  value: newLangId, maxLength: 10, autoFocus: true,
                  onInput: (e) => setNewLangId(e.target.value),
                  onKeyDown: (e) => { if (e.key === 'Enter') handleAddLang(); if (e.key === 'Escape') setAddLangOpen(false) },
                }),
                h('button', { className: 'kbth-btn', type: 'button', onClick: handleAddLang }, 'Ajouter'),
                h('button', { className: 'kbth-btn', type: 'button', onClick: () => { setAddLangOpen(false); setNewLangId('') } }, 'Annuler'))
            : h('button', { className: 'kbth-lang-add', type: 'button', onClick: () => setAddLangOpen(true) },
                '+ Ajouter une langue…'),
          // Sélecteur de modèle LLM pour la traduction
          providers.length > 0
            ? h('div', { className: 'kbth-row', style: { marginTop: 8 } },
                h('span', { className: 'kbth-lb' }, 'Modèle LLM'),
                h('select', {
                  className: 'kbth-select',
                  value: selectedProvider,
                  onChange: (e) => { setSelectedProvider(e.target.value); try { localStorage.setItem('kybernos.i18n.provider', e.target.value) } catch (ex) { /* */ } },
                  'aria-label': 'Modèle pour la traduction' },
                  providers.map((p) => h('option', { key: p.id, value: p.id }, p.name + ' (' + p.provider + ')'))))
            : null,
          h('div', { className: 'kbth-hint' },
            providers.length > 0
              ? 'Les traductions sont générées par le modèle sélectionné et mises en cache localement. Vous pouvez les exécuter en arrière-plan.'
              : 'Aucun modèle LLM détecté. Configurez un provider dans settings.yaml pour activer la traduction automatique.'))

        // ── Modale de traduction ───────────────────────────────────────────
        const translationModal = translateModal !== null
          ? h('div', { className: 'kbth-modal-overlay', onClick: (e) => { if (e.target === e.currentTarget && !translateRunning) setTranslateModal(null) } },
              h('div', { className: 'kbth-modal' },
                h('div', { className: 'kbth-modal-title' }, 'Traduction vers ' + translateModal.label),
                h('div', { className: 'kbth-modal-sub' },
                  translateErreur !== null ? ('Échec : ' + translateErreur) :
                  translateRunning ? 'avec le modèle actif…' :
                  translateCancelled ? 'Traduction annulée' : 'Traduction terminée'),
                h('div', { className: 'kbth-progress-track' },
                  h('div', { className: 'kbth-progress-fill',
                    style: { width: (translateProgress.total > 0 ? (translateProgress.done / translateProgress.total * 100) : (translateErreur !== null ? 0 : 0)).toFixed(1) + '%' } })),
                h('div', { className: 'kbth-progress-text' },
                  translateErreur !== null
                    ? 'aucune chaîne traduite — réessaie après correction'
                    : translateProgress.total > 0
                      ? translateProgress.done + ' / ' + translateProgress.total + ' chaînes traduites (' + Math.round(translateProgress.done / translateProgress.total * 100) + ' %)'
                      : 'Préparation…'),
                h('div', { className: 'kbth-modal-actions' },
                  translateRunning
                    ? h('button', { className: 'kbth-modal-btn', type: 'button',
                        onClick: () => { translateCancelRef.current = true } }, 'Annuler la traduction')
                    : null,
                  translateRunning
                    ? h('button', { className: 'kbth-modal-btn primary', type: 'button',
                        onClick: () => setTranslateModal(null) }, 'Exécuter en arrière-plan')
                    : h('button', { className: 'kbth-modal-btn primary', type: 'button',
                        onClick: () => { setTranslateModal(null); if (!translateCancelled && translateErreur === null) activerLangue(translateModal.lang) } }, 'Fermer'))))
          : null


        // ── assemblage ────────────────────────────────────────────────────
        return h(React.Fragment, null,
          h('div', { className: 'kbth-page' },
            h('div', { className: 'kbth-main' },
              h('div', { className: 'kbth-head' },
                h('div', { className: 'kbth-title' }, 'Langue'),
                h('div', { className: 'kbth-sub' },
                  'Choisissez la langue de l’interface. Ajoutez une nouvelle langue pour la traduire automatiquement.'))),
            // Le bloc `langue` porte DÉJÀ son intertitre : ne pas le répéter
            // sous le titre de page (constaté en capture le 01/10 — le titre
            // « Langue » apparaissait deux fois).
            h('div', null, langue)),
          translationModal)
      }


      // ══════════════════════════════════════════════════════════════════════
      // 3. MONTAGE.
      // ══════════════════════════════════════════════════════════════════════

      // Le contrat d'export d'une entrée cordis : la liste des services que le
      // contexte DOIT exposer — le garde de ctx refuse tout ctx.<service> non
      // déclaré ici (même contrat que kybernos et kybernos-theme). Sans elle,
      // l'entrée reste « loading » et n'active jamais.
      return {
        inject: ['slots', 'remote', 'locale'],
        apply(ctx) {
          // (01/10) Libellé selon l'état de langue lui-même : un shell en
          // anglais lit « Language », un shell français lit « Langue ».
          const kblLabel = (fr, en) => {
            try {
              const a = (typeof window !== 'undefined') ? window.__KB_I18N_ACTIVE__ : null
              const loc = (a !== null && a !== undefined && a.lang !== null && a.lang !== undefined) ? String(a.lang).toLowerCase() : ''
              return loc.indexOf('en') === 0 ? en : fr
            } catch (e) { return fr }
          }
          // Langue + sens de lecture DÈS L'ACTIVATION : au rechargement, la
          // direction (rtl pour l'arabe) et le dict actif sont posés avant que
          // l'utilisateur n'ouvre les réglages — `kbt` côté plugin principal
          // lit `__KB_I18N_ACTIVE__` dès son premier rendu.
          // (01/10) Sans choix explicite (pas de kybernos.theme.lang), un shell
          // en anglais est suivi : appliquer « en » plutôt que la maquette fr
          // par défaut, pour des onglets anglais sous un shell anglais.
          let kbBootLang = null
          try {
            if (localStorage.getItem('kybernos.theme.lang') === null) {
              const svc = (ctx !== null && ctx !== undefined && typeof ctx.get === 'function') ? ctx.get('locale') : null
              const snap = (svc !== null && svc !== undefined && typeof svc.getLocale === 'function') ? svc.getLocale() : null
              const loc = (snap !== null && snap !== undefined && snap.active !== null && snap.active !== undefined) ? String(snap.active).split(/[-_]/)[0].toLowerCase() : ''
              if (loc === 'en') kbBootLang = 'en'
            }
          } catch (e0) { /* service absent : comportement historique */ }
          try { applyLanguage(kbBootLang !== null ? kbBootLang : readActiveLang()) } catch (e) { /* silencieux */ }

          if (ctx !== null && ctx !== undefined && ctx.slots !== null && ctx.slots !== undefined) {
            ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register(
              { name: 'settings.section', id: 'kybernos-language', order: 2, label: kblLabel('Langue', 'Language') },
              (props) => h(Page, { ...props, ctx }))), 'kybernos-language: section réglages langue')

            ctx.effect(() => styles.insert(css), 'kybernos-language: styles')
          }
        }
      }
    } catch (kbLangBootError) {
      try {
        console.error('[kybernos-language] chargement impossible — plugin désactivé, GUI préservée', kbLangBootError)
      } catch (e2) { /* console indisponible */ }
      return { apply() { /* plugin désactivé après erreur de chargement */ } }
    }
  },
})
