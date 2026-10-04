// ═══════════════════════════════════════════════════════════════════════════
// @local/kybernos-composio — client : page Connections (catalogue riche,
// logos SVG, multi-connexions par app) + paramètre clé sur la page du bundle.
//
// Architecture (mesurée 2026-09-17) :
// - La clé ck_ n'ouvre QUE le MCP connect.composio.dev/mcp (backend REST 401).
// - Le MCP n'expose AUCUN catalogue : resources/list → -32601, et
//   COMPOSIO_SEARCH_TOOLS ne renvoie que 4-6 tools par requête. La grille
//   s'appuie donc sur CATALOG (100 apps, 99 logos SVG réels), servi par le host
//   sur GET /kybernos/composio/catalog et chargé à la demande (catalog.js).
// - COMPOSIO_MANAGE_CONNECTIONS action "list" en LOT : 500 toolkits en ~760 ms,
//   sans effet de bord (vérifié 2× : status "initiated", accounts [] stables).
//   C'est le mécanisme de découverte des connexions déjà existantes.
// - CORS : le MCP renvoie `access-control-allow-origin: *` mais les
//   NOTIFICATIONS (sans id) répondent 202 SANS header → ne jamais envoyer
//   notifications/initialized.
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
  id: '@local/kybernos-composio',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    let localeSvc = { current: () => 'kybernos' }

    // ── catalogue Composio : chargé à la demande depuis le host ───────────────
    // Les 412 Ko du catalogue ne sont plus inlinés dans ce bundle : le navigateur
    // ne les télécharge qu'en ouvrant Composio. catalog.js reste la source de
    // vérité, servie par GET /kybernos/composio/catalog (cache mémoire côté host).
    const CATALOG_URL = '/kybernos/composio/catalog'
    let CATALOG = []
    let CAT_BY_SLUG = {}
    let catalogLoad = null
    // catOk : vrai SEULEMENT après chargement d'un catalogue NON VIDE valide.
    // Un 200 + [] est une issue terminale valide (ready → true) mais laisse
    // catOk à false : c'est ce gate qui autorise la reprise opt-in de refresh.
    let catOk = false
    /** Charge le catalogue une seule fois (mémoire d'abord), puis le garde. */
    const kbCpCatalog = () => {
      if (CATALOG.length > 0) return Promise.resolve(CATALOG)
      if (catalogLoad !== null) return catalogLoad
      catalogLoad = fetch(CATALOG_URL, { credentials: 'same-origin' })
        .then((res) => {
          if (res === null || res === undefined || res.ok !== true) throw new Error('catalogue indisponible (' + String(res && res.status) + ')')
          return res.json()
        })
        .then((list) => {
          // 'catalogue invalide' est réservé au NON-tableau : un 200 + [] est
          // une issue terminale valide, qui résout [] sans peupler CATALOG.
          if (Array.isArray(list) !== true) throw new Error('catalogue invalide')
          // Vide-valide : on invalide catalogLoad, sinon la promesse résolue []
          // serait resservie par :36 et la reprise ne re-fetcherait jamais.
          if (list.length === 0) { catalogLoad = null; return [] }
          CATALOG = list
          const m = {}
          for (const a of CATALOG) m[a.s] = a
          CAT_BY_SLUG = m
          catOk = true
          return CATALOG
        })
        .catch((e) => { catalogLoad = null; throw e })
      return catalogLoad
    }

    // ── clé + client MCP minimal (streamable-http, JSON-RPC over POST) ───────
    const MCP_URL = 'https://connect.composio.dev/mcp'
    const KB_CP_KEY = 'composio.apiKey'
    // (01/10) réglage Local (gratuit, clé ck_ personnelle) vs Cloud (compte
    // Composio Platform payant — dashboard.composio.dev). Défaut : local.
    const KB_CP_MODE = 'composio.mode'
    const kbCpKey = () => { try { return localStorage.getItem(KB_CP_KEY) || '' } catch (e) { return '' } }
    const kbCpHas = () => kbCpKey().indexOf('ck_') === 0
    const kbCpMode = () => (localStorage.getItem(KB_CP_MODE) === 'cloud' ? 'cloud' : 'local')
    const kbCpSetMode = (m) => {
      if (m === 'cloud') localStorage.setItem(KB_CP_MODE, 'cloud')
      else localStorage.removeItem(KB_CP_MODE)
      try { window.dispatchEvent(new Event('kbcp-mode')) } catch (e) { }
    }

    // ── URL rule for everything the user can click or the page can open ──────
    // Card JSON is model output and `redirect_url` is a remote server's reply, so
    // neither is trusted. Only an absolute http(s) URL may become a link: a
    // `javascript:`, `data:` or `vbscript:` scheme, a relative or a malformed
    // value never does. Returns the normalised href (URL.href) or null.
    const kbCpWebUrl = (raw) => {
      if (typeof raw !== 'string') return null
      try {
        const u = new URL(raw)
        return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null
      } catch (e) { return null }
    }

    // Liens d'autorisation persistants par toolkit (rouvrables tant que non ACTIVE).
    // Composio annonce une expiration à 10 minutes : on stocke l'horodatage et on
    // masque le lien périmé (sinon une bannière morte reste affichée pour toujours).
    // The stored value is re-checked on read: localStorage is writable by anything
    // running on this origin, so what it holds is not trusted either.
    const KB_CP_LINKS = 'composio.authLinks'
    const LINK_TTL_MS = 10 * 60 * 1000
    const kbCpGetLink = (slug) => {
      try {
        const all = JSON.parse(localStorage.getItem(KB_CP_LINKS) || '{}')
        const e = all[slug]
        if (e === null || e === undefined) return null
        const url = typeof e === 'string' ? e : e.url
        const at = typeof e === 'string' ? 0 : e.at
        if (typeof url !== 'string' || url.length === 0) return null
        if (at && Date.now() - at > LINK_TTL_MS) return null
        return kbCpWebUrl(url)
      } catch (e2) { return null }
    }
    const kbCpSaveLink = (slug, url) => {
      const safe = kbCpWebUrl(url)
      if (safe === null) return
      try { const all = JSON.parse(localStorage.getItem(KB_CP_LINKS) || '{}'); all[slug] = { url: safe, at: Date.now() }; localStorage.setItem(KB_CP_LINKS, JSON.stringify(all)) } catch (e) { }
    }
    const kbCpDropLink = (slug) => { try { const all = JSON.parse(localStorage.getItem(KB_CP_LINKS) || '{}'); delete all[slug]; localStorage.setItem(KB_CP_LINKS, JSON.stringify(all)) } catch (e) { } }

    // ── minimal MCP client ───────────────────────────────────────────────────
    // One session at a time, remembered WITH the key it was opened for. It used to be
    // memoised for good, a failure included: a mistyped key (401) kept failing after the
    // right one was saved, until the page was reloaded, and the old Mcp-Session-Id was sent
    // with the new key. Now a new key, a failed initialize or an expired session (404) starts
    // a new session, and every exchange is bounded by ONE deadline (headers and body).
    const MCP_TIMEOUT = { ms: 20000 }
    let mcpSession = { key: null, id: null, ready: null }
    const mcpFail = (code, message) => { const e = new Error(message || code); e.code = code; return e }
    const mcpSessionFor = (key) => {
      if (mcpSession.key !== key) mcpSession = { key: key, id: null, ready: null }
      return mcpSession
    }
    const mcpRpc = async (method, params) => {
      const key = kbCpKey()
      const sess = mcpSessionFor(key)
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'x-consumer-api-key': key,
      }
      if (sess.id !== null) headers['Mcp-Session-Id'] = sess.id
      const controller = new AbortController()
      const deadline = new Promise((_resolve, reject) => { controller.signal.addEventListener('abort', () => reject(mcpFail('timeout', 'timeout')), { once: true }) })
      deadline.catch(() => { /* nothing races it any more */ })
      const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT.ms)
      const failed = (e) => (e !== null && e !== undefined && typeof e.code === 'string' ? e : mcpFail(controller.signal.aborted === true ? 'timeout' : 'offline', String((e && e.message) || e)))
      try {
        let r = null
        try { r = await Promise.race([fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() % 1e9, method, params }), signal: controller.signal }), deadline]) } catch (e) { throw failed(e) }
        const sid = r.headers.get('mcp-session-id')
        if (sid && mcpSession === sess) sess.id = sid
        let raw = ''
        try { raw = await Promise.race([r.text(), deadline]) } catch (e) { throw failed(e) }
        let payload = null
        for (const line of raw.split('\n')) {
          if (line.indexOf('data:') === 0) { try { payload = JSON.parse(line.slice(5).trim()) } catch (e) { } }
        }
        if (payload === null) { try { payload = JSON.parse(raw) } catch (e) { } }
        if (r.ok !== true) throw mcpFail(String(r.status), (payload && payload.error && payload.error.message) || ('HTTP ' + r.status))
        if (payload && payload.error) throw mcpFail('rpc-error', payload.error.message || 'MCP error')
        return payload ? payload.result : null
      } finally { clearTimeout(timer) }
    }
    const mcpReady = () => {
      const sess = mcpSessionFor(kbCpKey())
      if (sess.ready === null) {
        sess.ready = mcpRpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'kybernos-harness', version: '1.0' } })
          .catch((e) => { if (sess.ready !== null && mcpSession === sess) sess.ready = null; throw e })
      }
      return sess.ready
    }
    const kbCpCall = async (tool, args) => {
      if (kbCpHas() === false) throw new Error('nokey')
      const attempt = async () => {
        await mcpReady()
        return mcpRpc('tools/call', { name: tool, arguments: args })
      }
      try { return await attempt() } catch (e) {
        if (e === null || e === undefined || e.code !== '404') throw e
        // The server forgot the session: start a new one, once.
        mcpSession = { key: kbCpKey(), id: null, ready: null }
        return attempt()
      }
    }
    const kbCpText = (res) => {
      const c = res && Array.isArray(res.content) ? res.content : []
      const first = c.find((x) => x && typeof x.text === 'string')
      if (!first) return ''
      try { return JSON.parse(first.text) } catch (e) { return first.text }
    }

    // ── helpers catalogue / comptes ──────────────────────────────────────────
    // CAT_BY_SLUG est (re)construit à l'arrivée du catalogue (kbCpCatalog).
    const catOf = (slug) => CAT_BY_SLUG[slug] || null
    const nameOf = (slug) => { const c = catOf(slug); return c ? c.n : slug }
    const logoOf = (slug) => { const c = catOf(slug); return c ? c.l : null }

    /** Normalise la réponse de COMPOSIO_MANAGE_CONNECTIONS en { slug: {status, accounts[]} }. */
    /**
     * Libellé lisible d'un compte. L'API renvoie `user_info` avec, selon le
     * toolkit : `summary` (Google Calendar → l'email), `email`, `name`,
     * `username`, `screen_name`… On prend le premier disponible, sinon
     * l'alias posé par l'utilisateur, sinon l'id brut (dernier recours).
     */
    const accountLabel = (a) => {
      const ui = (a && a.user_info && typeof a.user_info === 'object') ? a.user_info : {}
      const cands = [a && a.alias, ui.summary, ui.email, ui.emailAddress, ui.name, ui.username, ui.screen_name, ui.login, a && a.client_name]
      for (const c of cands) {
        if (typeof c === 'string' && c.trim().length > 0 && c.trim() !== 'undefined') return c.trim()
      }
      return String((a && (a.id || a.connectedAccountId)) || '(compte)')
    }

    const parseAccounts = (raw) => {
      const out = {}
      if (raw === null || typeof raw !== 'object') return out
      const data = raw.data && typeof raw.data === 'object' ? raw.data : raw
      const results = data.results && typeof data.results === 'object' ? data.results : null
      if (results === null) return out
      for (const [slug, info] of Object.entries(results)) {
        const key = String(slug).toLowerCase()
        const accounts = Array.isArray(info && info.accounts) ? info.accounts : []
        out[key] = {
          status: String((info && info.status) || '').toLowerCase(),
          accounts: accounts.map((a) => ({
            id: String(a.id || a.connectedAccountId || ''),
            label: accountLabel(a),
            status: String(a.status || a.state || '').toUpperCase(),
          })),
        }
      }
      return out
    }

    /** Interroge un lot de toolkits (action list). Batch mesuré : 500 en ~760 ms. */
    const listBatch = async (slugs) => {
      const res = await kbCpCall('COMPOSIO_MANAGE_CONNECTIONS', { toolkits: slugs.map((name) => ({ name, action: 'list' })) })
      return parseAccounts(kbCpText(res))
    }

    // ── i18n ──────────────────────────────────────────────────────────────────
    const STR = {
      'composio.keylabel': { fr: 'Clé API Composio', en: 'Composio API key' },
      'composio.keydesc': { fr: "Collez votre clé Composio (elle commence par ck_). Elle pilote cet onglet ET les agents (MCP) — une seule clé.", en: 'Paste your Composio key (starts with ck_). It drives this tab AND the agents (MCP) — one single key.' },
      'composio.keysave': { fr: 'Enregistrer', en: 'Save' },
      'composio.keyclear': { fr: 'Effacer', en: 'Clear' },
      'composio.keyok': { fr: 'clé enregistrée dans ce navigateur', en: 'key saved in this browser' },
      'composio.keymissing': { fr: 'aucune clé dans ce navigateur', en: 'no key in this browser' },
      'composio.modelabel': { fr: 'Clé & mode Composio', en: 'Composio key & mode' },
      'composio.modelocal': { fr: 'Local · gratuit', en: 'Local · free' },
      'composio.modecloud': { fr: 'Cloud · local + cloud', en: 'Cloud · local + cloud' },
      'composio.modelocalnote': { fr: 'Le serveur MCP tourne sur votre machine avec votre clé personnelle — tout usage est gratuit, la clé pilote cet onglet ET les agents.', en: 'The MCP server runs on your machine with your own key — everything is free; the key drives this tab AND the agents.' },
      'composio.modecloudnote': { fr: 'Les connecteurs deviennent utilisables en local ET par les agents cloud.', en: 'Connectors become usable locally AND by cloud agents.' },
      'composio.modecloudrow': { fr: 'Fonctionne en local et depuis les agents cloud — via un compte Composio Platform, à l’usage facturé.', en: 'Works locally and from cloud agents — through a Composio Platform account, billed per usage.' },
      'composio.modelier': { fr: 'Lier Composio Platform…', en: 'Link Composio Platform…' },
      'composio.modecloudstate': { fr: 'compte Platform à lier', en: 'Platform account to link' },
      'composio.modehelpq': { fr: 'Comment trouver ma clé Composio ?', en: 'How do I find my Composio key?' },
      'composio.modehelp1': { fr: 'Ouvrez dashboard.composio.dev et connectez-vous (compte gratuit).', en: 'Open dashboard.composio.dev and sign in (free account).' },
      'composio.modehelp2': { fr: 'Menu Settings ▸ API Keys, puis Generate new key.', en: 'Menu Settings ▸ API Keys, then Generate new key.' },
      'composio.modehelp3': { fr: 'Collez la clé (elle commence par ck_…) ci-dessus — elle reste sur votre machine.', en: 'Paste the key (it starts with ck_…) above — it stays on your machine.' },
      'composio.keyhint': { fr: "Pour que les AGENTS du chat l'utilisent aussi, copiez la même clé dans ~/.dsh/.env (COMPOSIO_API_KEY=ck_…) puis redémarrez dsh.", en: "So the CHAT agents can use it too, copy the same key into ~/.dsh/.env (COMPOSIO_API_KEY=ck_…) then restart dsh." },
      'kb.cp.title': { fr: 'Connections', en: 'Connections' },
      'kb.cp.sub': { fr: 'Les comptes par lesquels vos Kybers agissent, via Composio. Plusieurs connexions par app — une par compte, boîte ou région.', en: 'The accounts your Kybers act through, via Composio. Multiple connections per app — one per account, mailbox or region.' },
      'kb.cp.search': { fr: 'Chercher une app — Slack, GitHub, facturation…', en: 'Search an app — Slack, GitHub, billing…' },
      'kb.cp.chipall': { fr: 'Toutes', en: 'All' },
      'kb.cp.chipconn': { fr: 'Connectées', en: 'Connected' },
      // (29/09) l'onglet Plugins a quitté la page Ressources : on vise Réglages.
      'kb.cp.nokey': { fr: "Ajoutez votre clé Composio dans Réglages → Plugins → kybernos-composio pour activer les connexions.", en: 'Add your Composio key under Settings → Plugins → kybernos-composio to enable connections.' },
      'kb.cp.connected': { fr: 'Connecté', en: 'Connected' },
      'kb.cp.pend': { fr: 'En attente', en: 'Pending' },
      'kb.cp.connect': { fr: 'Connecter', en: 'Connect' },
      'kb.cp.empty': { fr: 'Aucune app ne correspond.', en: 'No matching app.' },
      'kb.cp.openlink': { fr: 'Ouvrir la page d’autorisation', en: 'Open the authorization page' },
      'kb.cp.wait': { fr: 'Autorisation en cours — terminez dans l’onglet ouvert, puis attendez la confirmation…', en: 'Authorizing — finish in the opened tab, then wait for confirmation…' },
      'kb.cp.accounts': { fr: 'compte(s)', en: 'account(s)' },
      'kb.cp.manage': { fr: 'Gérer les connexions', en: 'Manage connections' },
      'kb.cp.addconn': { fr: 'Ajouter une connexion', en: 'Add a connection' },
      'kb.cp.remove': { fr: 'Supprimer', en: 'Remove' },
      'kb.cp.noacc': { fr: 'Aucun compte connecté pour cette app.', en: 'No account connected for this app.' },
      'kb.cp.loadall': { fr: 'Charger le catalogue complet (1547 apps)', en: 'Load the full catalog (1547 apps)' },
      'kb.cp.loading': { fr: 'Chargement…', en: 'Loading…' },
      'kb.cp.close': { fr: 'Fermer', en: 'Close' },
      'kb.cp.active': { fr: 'ACTIF', en: 'ACTIVE' },
      'kb.cp.alias': { fr: 'Alias (optionnel)', en: 'Alias (optional)' },
      'kb.cp.dismiss': { fr: 'Écarter ce lien', en: 'Dismiss this link' },
      'kb.cp.create': { fr: 'Créer', en: 'Create' },
      'kb.cp.custom': { fr: 'Connecteur personnalisé', en: 'Add custom connector' },
      'kb.cp.custom.hint': { fr: 'Ajouter un serveur MCP hors catalogue — serveur HTTP distant ou commande locale (stdio).', en: 'Add an off-catalog MCP server — remote HTTP server or local command (stdio).' },
      'kb.cp.custom.draft': { fr: "/skill-connecteur-personnalise Je veux ajouter un connecteur personnalisé (serveur MCP stdio ou HTTP, hors catalogue Composio). Commence l'entretien par ta première question.", en: "/skill-connecteur-personnalise I want to add a custom connector (stdio or HTTP MCP server, off the Composio catalog). Start the interview with your first question." },
      'kb.cp.form.title': { fr: 'Nouveau connecteur', en: 'New connector' },
      'kb.cp.form.edit': { fr: 'Modifier le connecteur', en: 'Edit connector' },
      'kb.cp.form.name': { fr: 'Nom (kebab-case, ex. tavily)', en: 'Name (kebab-case, e.g. tavily)' },
      'kb.cp.form.type': { fr: 'Type de serveur', en: 'Server type' },
      'kb.cp.form.http': { fr: 'HTTP distant', en: 'Remote HTTP' },
      'kb.cp.form.stdio': { fr: 'Commande locale (stdio)', en: 'Local command (stdio)' },
      'kb.cp.form.url': { fr: 'URL du serveur MCP (https://…)', en: 'MCP server URL (https://…)' },
      'kb.cp.form.command': { fr: 'Commande — chemin ABSOLU (ex. /opt/homebrew/bin/node)', en: 'Command — absolute path (e.g. /opt/homebrew/bin/node)' },
      'kb.cp.form.args': { fr: 'Arguments (séparés par des espaces)', en: 'Arguments (space-separated)' },
      'kb.cp.form.cwd': { fr: 'Répertoire de travail (optionnel)', en: 'Working directory (optional)' },
      'kb.cp.form.headers': { fr: 'En-têtes', en: 'Headers' },
      'kb.cp.form.env': { fr: "Variables d'environnement", en: 'Environment variables' },
      'kb.cp.form.secrets': { fr: 'Secrets (clés API)', en: 'Secrets (API keys)' },
      'kb.cp.form.secretname': { fr: 'NOM (ex. TAVILY_API_KEY)', en: 'NAME (e.g. TAVILY_API_KEY)' },
      'kb.cp.form.secretvalue': { fr: 'valeur — enregistrée dans ~/.dsh/.env, jamais dans la config', en: 'value — stored in ~/.dsh/.env, never in the config' },
      'kb.cp.form.tokenhint': { fr: "Astuce : dans un en-tête ou une variable, écris $NOM pour référencer le secret NOM (ex. « Bearer $TAVILY_API_KEY »).", en: 'Tip: in a header or env value, write $NAME to reference secret NAME (e.g. "Bearer $TAVILY_API_KEY").' },
      'kb.cp.form.addrow': { fr: 'Ajouter une ligne', en: 'Add row' },
      'kb.cp.form.save': { fr: 'Enregistrer le connecteur', en: 'Save connector' },
      'kb.cp.form.saved': { fr: 'Connecteur enregistré — il sera actif au prochain démarrage de DSH.', en: 'Connector saved — it will be active the next time DSH starts.' },
      'kb.cp.form.saving': { fr: 'Enregistrement…', en: 'Saving…' },
      'kb.cp.list.title': { fr: 'Connecteurs personnalisés', en: 'Custom connectors' },
      'kb.cp.list.tools': { fr: 'outils', en: 'tools' },
      'kb.cp.list.offform': { fr: 'hors formulaire', en: 'not from form' },
      'kb.cp.list.empty': { fr: 'Aucun connecteur personnalisé pour l’instant.', en: 'No custom connectors yet.' },
      'kb.cp.list.confirm': { fr: 'Supprimer ce connecteur du profil ?', en: 'Remove this connector from the profile?' },
      'kb.cp.list.removed': { fr: 'Connecteur supprimé — il disparaîtra au prochain démarrage de DSH.', en: 'Connector removed — it will disappear the next time DSH starts.' },
      'kb.cp.refresh': { fr: 'Rafraîchir', en: 'Refresh' },
      'kbui.sort.az': { fr: 'A → Z', en: 'A → Z' },
      // (29/09) sous-onglets + aide « Connecteurs locaux ».
      'kb.cp.tab.yours': { fr: 'Vos connexions', en: 'Yours' },
      'kb.cp.tab.discover': { fr: 'Découvrir', en: 'Discover' },
      'kb.cp.info': { fr: 'À propos des connecteurs locaux', en: 'About Local Connectors' },
      'kb.cp.help.title': { fr: 'Connecteurs locaux — mode d’emploi', en: 'Local Connectors — how it works' },
      'kb.cp.help': { fr: 'Vos connexions : les apps déjà reliées à vos Kybers, plus vos connecteurs personnalisés (MCP). Découvrir : le catalogue complet, connexion en un clic. Les agents du chat lisent la même clé côté hôte (~/.dsh/.env).', en: 'Yours: apps already linked to your Kybers, plus your custom connectors (MCP). Discover: the full catalog, one-click connect. Chat agents read the same host-side key (~/.dsh/.env).' },
      'kb.cp.yours.empty': { fr: 'Aucune app connectée pour l’instant — le catalogue vous attend.', en: 'No app connected yet — the catalog is waiting for you.' },
      // (POC) pilule « Kybernos » de la page Plugins du moteur.
      'kb.cp.kbf.help': { fr: 'Ne montrer que les plugins Kybernos (@local/kybernos-*)', en: 'Show only Kybernos plugins (@local/kybernos-*)' },
      'kb.cp.yours.go': { fr: 'Parcourir le catalogue', en: 'Browse the catalog' },
      // What a failed call says, by code (the host and the MCP client use the same codes).
      'kb.cp.err.401': { fr: 'Composio a refusé la clé API (401). Vérifiez-la dans ~/.dsh/.env ou dans le panneau de la clé.', en: 'Composio rejected the API key (401). Check it in ~/.dsh/.env or in the key panel.' },
      'kb.cp.err.429': { fr: 'Composio limite le débit (429) : réessayez dans un instant.', en: 'Composio is rate limiting requests (429): try again in a moment.' },
      'kb.cp.err.timeout': { fr: 'Composio n’a pas répondu à temps.', en: 'Composio did not answer in time.' },
      'kb.cp.err.offline': { fr: 'Composio est injoignable (réseau).', en: 'Composio cannot be reached (network).' },
      'kb.cp.err.other': { fr: 'Composio a répondu par une erreur ({code}).', en: 'Composio answered with an error ({code}).' },
      // Key panel: what the HOST (the agents) sees, as opposed to this browser.
      'composio.hostok': { fr: 'Agents : clé trouvée côté hôte', en: 'Agents: key found on the host' },
      'composio.hostmissing': { fr: 'Agents : aucune clé côté hôte — copiez-la dans ~/.dsh/.env (COMPOSIO_API_KEY=ck_…) puis redémarrez dsh.', en: 'Agents: no key on the host — copy it into ~/.dsh/.env (COMPOSIO_API_KEY=ck_…) then restart dsh.' },
      'composio.hostbad': { fr: 'Agents : la clé côté hôte est refusée par Composio', en: 'Agents: the key on the host is rejected by Composio' },
      'composio.hosterr': { fr: 'Agents : clé côté hôte trouvée, mais Composio ne répond pas bien', en: 'Agents: key found on the host, but Composio is not answering well' },
      'composio.hostunknown': { fr: 'Agents : état côté hôte inconnu (plugin hôte injoignable)', en: 'Agents: state on the host unknown (host plugin unreachable)' },
      // Card button that sends text into the conversation: the text is shown first.
      'kb.cp.accept.confirm': { fr: 'Envoyer ce message dans la conversation ?', en: 'Send this message in the conversation?' },
      'kb.cp.accept.toolong': { fr: 'Ce message est trop long pour être envoyé d’un clic : il n’a pas été envoyé.', en: 'This message is too long to send with one click: it was not sent.' },
    }
    const kbt = (key) => {
      const row = STR[key]
      if (row === null || row === undefined) return key
      let lang = 'kybernos'
      try { if (localeSvc !== null && localeSvc !== undefined && typeof localeSvc.current === 'function') lang = String(localeSvc.current() || '') } catch (e) { }
      // (01/10) « kybernos » est le DÉFAUT du thème, pas un choix : sans langue
      // explicite (clé kybernos.theme.lang absente) et sous un shell anglais,
      // servir l'anglais — même politique que kybernos-plugin (kbLangActive),
      // sinon la page Ressources mélange titres anglais et corps français.
      if (lang === 'kybernos') {
        try {
          if (localStorage.getItem('kybernos.theme.lang') === null && localeSvc !== null && localeSvc !== undefined && typeof localeSvc.getLocale === 'function') {
            const snap = localeSvc.getLocale()
            if (snap !== null && snap !== undefined && String(snap.active) === 'en') lang = 'en'
          }
        } catch (e) { /* storage ou service indisponible : défaut */ }
      }
      if (lang !== 'kybernos' && lang !== 'fr') {
        const tag = lang.slice(0, 2).toLowerCase()
        if (row[tag] !== null && row[tag] !== undefined) return row[tag]
      }
      return row.fr !== null && row.fr !== undefined ? row.fr : row.en
    }

    /** A failure code (host route or MCP client) as a sentence the user can act on. */
    const kbCpErrText = (code) => {
      const c = String(code === null || code === undefined ? '' : code)
      if (c === '401' || c === '403') return kbt('kb.cp.err.401')
      if (c === '429') return kbt('kb.cp.err.429')
      if (c === 'timeout') return kbt('kb.cp.err.timeout')
      if (c === 'offline') return kbt('kb.cp.err.offline')
      return kbt('kb.cp.err.other').replace('{code}', c.length > 0 ? c : '?')
    }
    /** The text for an error thrown by the MCP client: its code when it has one, else its message. */
    const kbCpErrOf = (e) => (e !== null && e !== undefined && typeof e.code === 'string' && e.code.length > 0 ? kbCpErrText(e.code) : String((e && e.message) || e))
    /**
     * What the key panel says about the HOST, from GET /kybernos/composio/connections. The panel
     * used to read only the browser's copy of the key and show green while the agents, which
     * read process.env.COMPOSIO_API_KEY from ~/.dsh/.env, had no key at all. null = the reply
     * is unusable (the host plugin is not there).
     */
    const kbCpHostState = (reply) => {
      if (reply === null || reply === undefined || typeof reply !== 'object' || reply.ok !== true) return { level: 'unknown', key: 'composio.hostunknown' }
      if (reply.configured !== true) return { level: 'warn', key: 'composio.hostmissing' }
      const err = reply.error === undefined || reply.error === null ? null : String(reply.error)
      if (err === null) return { level: 'ok', key: 'composio.hostok' }
      if (err === '401' || err === '403') return { level: 'bad', key: 'composio.hostbad' }
      return { level: 'warn', key: 'composio.hosterr' }
    }

    // ── icônes Lucide (SVG inline) ────────────────────────────────────────────
    const LUCIDE = {
      key: ['M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-3.9-3.9L2 18Z', 'M16.5 7.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z'],
      check: ['M20 6 9 17l-5-5'],
      refresh: ['M21 12a9 9 0 1 1-2.6-6.3', 'M21 3v6h-6'],
      plus: ['M12 5v14', 'M5 12h14'],
      link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
      ext: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
      trash: ['M3 6h18', 'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'],
      x: ['M18 6 6 18', 'M6 6l12 12'],
      sparkles: ['M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L13.664 8.5A2 2 0 0 0 15.1 9.937l6.135 1.581a.5.5 0 0 1 0 .962L15.1 13.664a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z', 'M20 3v4', 'M22 5h-4', 'M4 17v2', 'M5 18H3'],
      pencil: ['M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z'],
      info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-5', 'M12 8h.01'],
    }
    const Icon = (name, size) => {
      const d = LUCIDE[name]
      if (d === null || d === undefined) return null
      return h('svg', { width: size === undefined ? 16 : size, height: size === undefined ? 16 : size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', style: { flex: 'none' } },
        d.map((p, i) => h('path', { d: p, key: i })))
    }

    // ── logo d'app : SVG réel embarqué, fallback tuile initiale ──────────────
    const APP_TILES = {
      gmail: { bg: '#ffffff', color: '#EA4335', border: true }, slack: { bg: '#4A154B', color: '#fff' },
      notion: { bg: '#ffffff', color: '#111', border: true }, github: { bg: '#111', color: '#fff' },
      linear: { bg: '#5e6ad2', color: '#fff' }, googledrive: { bg: '#fff', color: '#1FA463', border: true },
      cal: { bg: '#fff', color: '#1A73E8', border: true }, googlesheets: { bg: '#fff', color: '#0F9D58', border: true },
      whatsapp: { bg: '#25D366', color: '#fff' }, airtable: { bg: '#fff', color: '#fcb400', border: true },
      calendly: { bg: '#fff', color: '#006bff', border: true },
    }
    const AppLogo = (slug, size) => {
      const svg = logoOf(slug)
      if (svg) {
        return h('div', {
          className: 'kb7-applogo',
          style: { width: size, height: size, borderRadius: 10, background: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', overflow: 'hidden', border: '1px solid rgba(128,128,128,.18)' },
          // SVG embarqué (width/height retirés à la génération, ids préfixés).
          // La règle .kb7-applogo svg le dimensionne à 74 % du conteneur.
          dangerouslySetInnerHTML: { __html: svg },
        })
      }
      const t = APP_TILES[slug] || { bg: 'rgba(128,128,128,.18)', color: 'inherit' }
      return h('div', { style: { width: size, height: size, borderRadius: 10, background: t.bg, color: t.color, border: t.border === true ? '1px solid rgba(128,128,128,.3)' : 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: Math.round(size * 0.42), flex: 'none' } },
        String(nameOf(slug) || '?').charAt(0).toUpperCase())
    }

    // ── CSS (classes kb7-*) ──────────────────────────────────────────────────
    const CSS = `
.kbcp-config{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:1px solid rgba(128,128,128,.25);border-radius:12px;max-width:680px}
.kbcp-config h3{margin:0;font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}
.kbcp-logo{width:20px;height:20px;border-radius:6px;background:linear-gradient(135deg,#ff7a1a,#f43f5e);color:#fff;font-weight:800;font-size:11px;display:inline-flex;align-items:center;justify-content:center}
.kbcp-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.kbcp-input{flex:1;min-width:200px;height:34px;border-radius:9px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;padding:0 11px;font-size:13px}
.kbcp-btn{height:32px;padding:0 13px;border-radius:8px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.kbcp-btn:hover{background:rgba(128,128,128,.12)}
.kbcp-btn.primary{background:#635bff;border-color:#635bff;color:#fff}
.kbcp-btn.primary:hover{filter:brightness(1.08)}
.kbcp-btn:disabled{opacity:.5;cursor:default}
/* (POC filtre Kybernos) Pilule dans la barre d’en-tête de la page Plugins du
   moteur (dsh-client-ui-plugin-manager) : masque les groupes/cartes non
   Kybernos quand elle est active. Sélecteurs par data-plugin-* — contrat
   public du panneau, stable malgré les classes hachées. */
.kbcp-kbfpill{height:28px;padding:0 11px;border-radius:999px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.kbcp-kbfpill:hover{background:rgba(128,128,128,.12)}
.kbcp-kbfpill.on{background:#ff7a1a;border-color:#ff7a1a;color:#fff;font-weight:600}
.kbcp-kbfbadge{min-width:16px;height:16px;padding:0 4px;border-radius:99px;background:rgba(128,128,128,.25);font-size:10.5px;line-height:16px;text-align:center}
.kbcp-kbfpill.on .kbcp-kbfbadge{background:rgba(255,255,255,.3)}
[data-plugin-panel].kbcp-kbf-on [data-plugin-group="official"]{display:none !important}
[data-plugin-panel].kbcp-kbf-on [data-plugin-group="bundles"] li[data-plugin-package]:not([data-plugin-package^="@local/kybernos"]){display:none !important}
.kbcp-state{display:inline-flex;align-items:center;gap:6px;font-size:12px}
.kbcp-dot{width:8px;height:8px;border-radius:99px;background:rgba(128,128,128,.5)}
.kbcp-dot.on{background:#22c55e}
.kbcp-dot.warn{background:#f59e0b}
.kbcp-dot.bad{background:#ef4444}
/* réglage Local/Cloud : deux pilules dans une kbcp-row (valeurs kb7-chip) ;
   le violet #635bff est celui du bouton primary — lisible clair ET sombre */
.kbcp-modepill{height:30px;padding:0 12px;border-radius:999px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.kbcp-modepill:hover{background:rgba(128,128,128,.12)}
.kbcp-modepill.on{background:#635bff;border-color:#635bff;color:#fff}
.kbcp-modepill .kbcp-dot{width:7px;height:7px}
.kbcp-modepill.on .kbcp-dot{background:#fff}
.kbcp-help{font-size:12px;opacity:.75}
.kbcp-help summary{cursor:pointer;font-size:12.5px;width:fit-content}
.kbcp-help ol{margin:8px 0 0;padding-inline-start:20px;display:flex;flex-direction:column;gap:4px}
.kbcp-help a{color:var(--dsw-alias-label-secondary);text-decoration:underline}
.kbcp-note{font-size:11.5px;opacity:.65;line-height:1.5}
.kbcp-code{font-family:ui-monospace,Menlo,monospace;font-size:11px;opacity:.75}
.kb7-root{display:flex;flex-direction:column;gap:16px;padding:4px 0 24px;position:relative}
.kb7-head{display:flex;flex-direction:column;gap:4px}
.kb7-h1{margin:0;font-size:20px;font-weight:700;letter-spacing:-.01em}
.kb7-sub{margin:0;font-size:13px;opacity:.7;max-width:720px;line-height:1.5}
.kb7-search{height:38px;border-radius:10px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;padding:0 12px;font-size:13.5px;max-width:620px}
.kb7-chips{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.kb7-chip{height:30px;padding:0 12px;border-radius:999px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;font-size:12.5px;cursor:pointer}
.kb7-chip.on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.kb7-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;max-width:1180px}
.kb7-card{display:flex;flex-direction:column;gap:8px;padding:14px;border:1px solid rgba(128,128,128,.25);border-radius:14px;background:transparent;cursor:pointer;text-align:left;color:inherit;font:inherit}
.kb7-card:hover{background:rgba(128,128,128,.07);border-color:rgba(128,128,128,.45)}
.kb7-lr{display:flex;align-items:center;gap:10px}
.kb7-applogo svg{width:74%;height:74%;display:block}
.kb7-mhead .kb7-applogo svg{width:72%;height:72%}
.kb7-name{font-size:14px;font-weight:600}
.kb7-cat{font-size:11.5px;opacity:.6}
.kb7-desc{font-size:12.5px;opacity:.75;line-height:1.45;min-height:36px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.kb7-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:28px}
.kb7-pill{font-size:11px;font-weight:600;padding:2px 9px;border-radius:999px;background:rgba(34,197,94,.15);color:#22c55e;white-space:nowrap}
.kb7-pill.pend{background:rgba(250,204,21,.15);color:#facc15}
.kb7-bars{display:flex;gap:4px}
.kb7-bar{height:4px;flex:1;border-radius:2px;background:#22c55e;opacity:.55}
.kb7-bar.pend{background:#facc15}
.kb7-nokey{display:flex;align-items:center;gap:8px;padding:12px 14px;border:1px dashed rgba(128,128,128,.4);border-radius:12px;font-size:12.5px;opacity:.8;max-width:620px}
.kb7-err{font-size:12px;color:#f87171;max-width:620px}
.kb7-empty{font-size:12.5px;opacity:.6}
.kb7-more{align-self:flex-start}
.kb7-auth{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid rgba(99,91,255,.5);border-radius:12px;max-width:620px;font-size:12.5px}
.kb7-authrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.kb7-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px}
.kb7-modal{background:var(--dsw-alias-bg-base,#16161a);border:1px solid rgba(128,128,128,.3);border-radius:16px;max-width:520px;width:100%;max-height:82vh;overflow:auto;padding:18px}
.kb7-mhead{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.kb7-mname{font-size:17px;font-weight:700}
.kb7-mcat{font-size:11.5px;opacity:.6}
.kb7-mdesc{font-size:13px;opacity:.75;line-height:1.5;margin:0 0 14px}
.kb7-acc{display:flex;align-items:center;gap:10px;padding:11px 0;border-top:1px solid rgba(128,128,128,.2)}
.kb7-accname{font-size:13px;font-weight:600;color:inherit}
.kb7-accid{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;opacity:.5;word-break:break-all}
.kb7-accst{font-size:11px;font-weight:600}
.kb7-accst.on{color:#22c55e}
.kb7-accst.pend{color:#facc15}
.kb7-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.kb7-close{position:absolute;top:12px;right:14px}
/* Repli du bouton dédié « Create with AI » : le bundle kybernos porte la vraie
   règle .kb-createai ; celle-ci, scopée à cette page, garantit le même rendu
   (mêmes couleurs, même forme) même si son CSS n'est pas inséré ici. */
.kb7-root .kb-createai{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border:none;border-radius:9px;background:#e5484d;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
.kb7-root .kb-createai:hover{background:#d63b40}
/* Connecteurs personnalisés : section de liste + formulaire modal. */
.kb7-cxsec{display:flex;flex-direction:column;gap:8px;max-width:1180px}
.kb7-cxtitle{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;margin:6px 0 0}
.kb7-cxcount{font-size:11px;font-weight:600;opacity:.6}
.kb7-cxrow{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgba(128,128,128,.25);border-radius:12px}
.kb7-cxname{font-size:13px;font-weight:600}
.kb7-cxpath{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;opacity:.55;word-break:break-all}
.kb7-cxtype{font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 8px;border-radius:999px;background:rgba(99,91,255,.16);color:#8b85ff;white-space:nowrap}
.kb7-cxtype.http{background:rgba(34,197,94,.14);color:#22c55e}
/* (29/09) Sous-onglets Vos connexions / Découvrir + aide ⓘ — même langage que
   kb4-tab (barre d'onglets de page), posé ici pour rester montable hors plugin. */
.kb7-titlerow{display:flex;align-items:center;gap:8px}
.kb7-infobtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:999px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;opacity:.65;cursor:pointer;flex:none}
.kb7-infobtn:hover,.kb7-infobtn.on{opacity:1;border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.kb7-help{display:flex;flex-direction:column;gap:4px;padding:12px 14px;border:1px dashed rgba(128,128,128,.4);border-radius:12px;font-size:12.5px;line-height:1.55;max-width:720px}
.kb7-helptitle{font-weight:700;font-size:12.5px}
.kb7-help .kb7-helptext{margin:0;opacity:.75}
.kb7-ctlrow{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;position:relative;min-height:44px}
/* (01/10) Chargement, vide et erreurs occupent TOUJOURS la même place : une boîte au gabarit des cartes,
   pas un texte nu qui fait sauter la page quand les données arrivent. */
.kb7-emptybox{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;min-height:132px;padding:24px;border:1px dashed var(--dsw-alias-border-l2);border-radius:14px;text-align:center;max-width:1180px}
.kb7-emptybox .kb7-empty{opacity:.7}
.kb7-panel>*{max-width:1180px}
/* La barre recherche/filtre reste sur UNE ligne, calée à droite, sous la largeur des sous-onglets : jamais de retour à la ligne
   (le champ de recherche qui s'ouvre ne doit pas pousser le contenu). */
.kb7-ctlrow .kb6-toolbar{flex:1 1 0;min-width:0;display:flex;justify-content:flex-end}
.kb7-ctlrow .kb6-tb-row{flex-wrap:nowrap;justify-content:flex-end;min-width:0}
.kb7-ctlrow .kb6-tb-tools{flex-wrap:nowrap;width:auto;justify-content:flex-end}
.kb7-ctlrow .kb6-tb-tools{margin-inline-start:auto}
.kb7-ctlrow .kb6-tb-trailing{margin-inline-start:8px;gap:8px}
.kb7-ctlrow .kb6-tb-trailing:empty{display:none}
/* Sous-onglets en groupe pilule (maquette « Resources » 29/09) : conteneur
   discret, bouton actif en carte blanche surélevée, compteur mono. */
.kb7-subtabs{display:inline-flex;align-items:center;gap:2px;padding:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.kb7-subtab{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 16px;border-radius:999px;font-size:13px;font-weight:600;cursor:pointer;border:0;background:transparent;color:var(--dsw-alias-label-secondary)}
.kb7-subtab:hover{color:var(--dsw-alias-label-primary)}
.kb7-subtab.on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 3px rgba(20,20,19,.14)}
.kb7-panel{display:flex;flex-direction:column;gap:12px}
.kb7-yoursempty{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:18px 0}
.kb7-cxspacer{flex:1;min-width:8px}
.kb7-form{display:flex;flex-direction:column;gap:10px}
.kb7-flabel{font-size:11.5px;font-weight:600;opacity:.75;display:block;margin-bottom:4px}
.kb7-finput{width:100%;height:34px;border-radius:9px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;padding:0 11px;font-size:13px;box-sizing:border-box}
.kb7-frow{display:flex;gap:8px;align-items:center}
.kb7-frow .kb7-finput{flex:1;min-width:0}
.kb7-fseg{display:flex;gap:0;border:1px solid rgba(128,128,128,.3);border-radius:9px;overflow:hidden;width:max-content}
.kb7-fseg button{height:32px;padding:0 14px;border:none;background:transparent;color:inherit;font:inherit;font-size:12.5px;cursor:pointer}
.kb7-fseg button.on{background:var(--dsw-alias-brand-primary);color:#fff}
.kb7-fgroup{border:1px dashed rgba(128,128,128,.35);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.kb7-fgrouptitle{font-size:11.5px;font-weight:700;opacity:.8}
.kb7-fhint{font-size:11px;opacity:.6;line-height:1.5}
.kb7-fok{font-size:12px;color:#22c55e}
.kb7-ferr{font-size:12px;color:#f87171}
/* ── cartes de ressources dans le chat (bloc clôturé kybernos-carte) ──── */
.kbcp-cartes{display:flex;flex-direction:column;gap:8px;margin:10px 0}
.kbcp-carte{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px;background:var(--dsw-alias-markdown-code-block,#1b1b1c);border:1px solid var(--dsw-alias-border-l2,#ffffff1f);box-shadow:var(--dsw-elevation-stroke,0 0 0 .5px #fff3),var(--dsw-shadow-lv1,0 2px 4px 0 #0000000d)}
.kbcp-carte-logo{width:40px;height:40px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:20px;line-height:1;background:var(--dsw-alias-border-l1,#ffffff0f);overflow:hidden}
.kbcp-carte-logo svg{width:28px;height:28px}
.kbcp-carte-corps{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.kbcp-carte-titre{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary,#f9fafb);line-height:1.3;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kbcp-carte-nom{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
.kbcp-carte-type{font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:var(--dsw-alias-border-l2,#ffffff1f);color:var(--dsw-alias-label-tertiary,#adb2b8)}
.kbcp-carte-desc{font-size:12.5px;color:var(--dsw-alias-label-secondary,#cfd3d6);line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
.kbcp-carte-note{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#adb2b8);line-height:1.4}
.kbcp-carte-lien{display:inline-flex;align-items:center;gap:5px;width:fit-content;margin-top:2px;font-size:11px;color:var(--dsw-alias-label-tertiary,#adb2b8);text-decoration:none;cursor:pointer}
.kbcp-carte-lien:hover{color:var(--dsw-alias-label-secondary,#cfd3d6);text-decoration:none}
[class*="_markdown_"] a.kbcp-carte-lien{color:var(--dsw-alias-label-tertiary,#adb2b8);text-decoration:none}
[class*="_markdown_"] a.kbcp-carte-lien:hover{color:var(--dsw-alias-label-secondary,#cfd3d6);text-decoration:none}
.kbcp-carte-etat{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600}
.kbcp-carte-pt{width:6px;height:6px;border-radius:50%;background:currentColor}
.kbcp-etat-ok{color:var(--dsw-alias-state-success-primary,#22c55e)}
.kbcp-etat-off{color:var(--dsw-alias-state-error-primary,#f25a5a)}
.kbcp-etat-alerte{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbcp-etat-inconnu{color:var(--dsw-alias-state-idle-primary,#545557)}
.kbcp-carte-action{flex-shrink:0;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border-radius:8px;border:1px solid transparent;background:var(--dsw-alias-button-primary-fill,#f9fafb);color:var(--dsw-alias-label-primary-foreground,#18181b);font-size:12.5px;font-weight:600;text-decoration:none;cursor:pointer}
.kbcp-carte-action:hover{filter:brightness(.96)}
/* le markdown peint ses liens en bleu (regle ._markdown_ a) : doubler la
   specificite pour que le bouton garde sa paire native (fond + libelle) */
[class*="_markdown_"] a.kbcp-carte-action{color:var(--dsw-alias-label-primary-foreground,#18181b);text-decoration:none}
.kbcp-carte-ghost{flex-shrink:0;display:inline-flex;align-items:center;height:28px;padding:0 11px;border-radius:7px;border:1px solid var(--dsw-alias-border-l3,#ffffff29);color:var(--dsw-alias-label-secondary,#cfd3d6);font-size:11.5px}
`

    // ── Config clé (page du bundle, Plugins) ─────────────────────────────────
    const ComposioKeyConfig = () => {
      const p1 = React.useState('')
      const v = p1[0]
      const setV = p1[1]
      const p2 = React.useState(kbCpHas())
      const has = p2[0]
      const setHas = p2[1]
      const p3 = React.useState(null)
      const probe = p3[0]
      const setProbe = p3[1]
      React.useEffect(() => { setHas(kbCpHas()) }, [])
      React.useEffect(() => {
        if (kbCpHas() === false) { setProbe(null); return undefined }
        let dead = false
        mcpReady().then(() => { if (dead === false) setProbe('ok') }).catch((e) => { if (dead === false) setProbe(e !== null && e !== undefined && typeof e.code === 'string' ? e.code : 'err') })
        return () => { dead = true }
      }, [has])
      // What the HOST sees. The agents read COMPOSIO_API_KEY from ~/.dsh/.env, not this browser's
      // copy, so the key being saved here proves nothing about them.
      const pH = React.useState(null)
      const hostState = pH[0]
      const setHostState = pH[1]
      React.useEffect(() => {
        let dead = false
        let reply = null
        Promise.resolve().then(() => fetch('/kybernos/composio/connections?toolkits=gmail', { credentials: 'same-origin' }))
          .then((r) => (r.ok === true ? r.json() : null))
          .catch(() => null)
          .then((j) => { reply = j; if (dead === false) setHostState(kbCpHostState(reply)) })
        return () => { dead = true }
      }, [has])
      const save = () => {
        const val = String(v).trim()
        if (val.length > 6 && val.indexOf('ck_') === 0) { localStorage.setItem(KB_CP_KEY, val); setHas(true); setV(''); try { window.dispatchEvent(new Event('kbcp-key')) } catch (e) { } }
      }
      const clear = () => { localStorage.removeItem(KB_CP_KEY); setHas(false); try { window.dispatchEvent(new Event('kbcp-key')) } catch (e) { } }
      // (01/10) réglage Local (gratuit) / Cloud (payant) — maquette composio-cloud v3 :
      // seul ajout au bloc, tout le reste de la page est inchangé.
      const p4 = React.useState(kbCpMode())
      const mode = p4[0]
      const setMode = p4[1]
      const choisir = (m) => { kbCpSetMode(m); setMode(m) }
      const local = mode !== 'cloud'
      const DASH = 'https://dashboard.composio.dev/'
      return h('div', { className: 'kbcp-config' },
        h('h3', null, h('span', { className: 'kbcp-logo' }, 'C'), kbt('composio.modelabel')),
        h('div', { className: 'kbcp-row', role: 'group', 'aria-label': 'Composio mode' },
          h('button', { type: 'button', className: 'kbcp-modepill' + (local ? ' on' : ''), 'aria-pressed': local ? 'true' : 'false', onClick: () => choisir('local') },
            h('span', { className: 'kbcp-dot' + (local && has === true ? ' on' : '') }), kbt('composio.modelocal')),
          h('button', { type: 'button', className: 'kbcp-modepill' + (local ? '' : ' on'), 'aria-pressed': local ? 'false' : 'true', onClick: () => choisir('cloud') },
            h('span', { className: 'kbcp-dot' }), kbt('composio.modecloud')),
          h('span', { className: 'kbcp-state' },
            h('span', { className: 'kbcp-dot' + (local ? (has === true ? ' on' : '') : ' warn') }),
            local ? (has === true ? kbt('composio.keyok') : kbt('composio.keymissing')) : kbt('composio.modecloudstate'))),
        h('div', { className: 'kbcp-note' }, kbt(local ? 'composio.modelocalnote' : 'composio.modecloudnote')),
        local ? h('div', { className: 'kbcp-row' },
          h('input', { className: 'kbcp-input', type: 'password', value: v, placeholder: 'ck_…', onChange: (e) => setV(e.target.value), autoComplete: 'off' }),
          h('button', { type: 'button', className: 'kbcp-btn primary', onClick: save }, kbt('composio.keysave')),
          h('button', { type: 'button', className: 'kbcp-btn', onClick: clear }, kbt('composio.keyclear')),
          has === true ? h('span', { className: 'kbcp-code' }, probe === 'ok' ? 'MCP ✓' : (probe === null ? '…' : 'MCP ✗ ' + probe)) : null) : null,
        local && hostState !== null ? h('div', { className: 'kbcp-row' },
          h('span', { className: 'kbcp-state', 'data-kb': 'composio-host-state' },
            h('span', { className: 'kbcp-dot' + (hostState.level === 'ok' ? ' on' : (hostState.level === 'bad' ? ' bad' : ' warn')) }),
            kbt(hostState.key))) : null,
        local ? h('details', { className: 'kbcp-help' },
          h('summary', null, kbt('composio.modehelpq')),
          h('ol', null,
            h('li', null, h('a', { href: DASH, target: '_blank', rel: 'noopener' }, 'dashboard.composio.dev'), ' — ', kbt('composio.modehelp1')),
            h('li', null, kbt('composio.modehelp2')),
            h('li', null, kbt('composio.modehelp3')))) : null,
        local ? h('div', { className: 'kbcp-row' },
          h('span', { className: 'kbcp-note' }, kbt('composio.keyhint'))) : h('div', { className: 'kbcp-row' },
          h('span', { className: 'kbcp-note', style: { flex: 1 } }, kbt('composio.modecloudrow')),
          h('a', { className: 'kbcp-btn primary', href: DASH, target: '_blank', rel: 'noopener' }, kbt('composio.modelier'))))
    }

    // ── formulaire « connecteur personnalisé » (parle à la route host) ────────
    // Le serveur écrit lui-même la config et le .env : l'utilisateur ne voit
    // jamais le YAML. Une valeur de champ peut référencer un secret par $NOM.
    const EMPTY_FORM = () => ({ nom: '', transport: 'streamable-http', url: '', command: '', args: '', cwd: '', headers: [], env: [], secrets: [] })
    const ConnecteurForm = (props) => {
      const p0 = React.useState(() => {
        const it = props.initial !== null && props.initial !== undefined ? props.initial : null
        if (it === null) return EMPTY_FORM()
        return {
          nom: String(it.nom || ''), transport: it.transport === 'stdio' ? 'stdio' : 'streamable-http',
          url: String(it.url || ''), command: String(it.command || ''),
          args: Array.isArray(it.args) ? it.args.join(' ') : String(it.args || ''),
          cwd: String(it.cwd || ''),
          headers: Array.isArray(it.headers) ? it.headers.map((x) => ({ name: String(x.name || ''), value: String(x.value || '') })) : [],
          env: Array.isArray(it.env) ? it.env.map((x) => ({ name: String(x.name || ''), value: String(x.value || '') })) : [],
          secrets: [],
        }
      })
      const f = p0[0]
      const setF = p0[1]
      const p1 = React.useState(false)
      const busy = p1[0]
      const setBusy = p1[1]
      const p2 = React.useState(null)
      const ferr = p2[0]
      const setFerr = p2[1]
      const up = (patch) => setF((prev) => Object.assign({}, prev, patch))
      const setRow = (key, i, field, value) => setF((prev) => Object.assign({}, prev, { [key]: prev[key].map((x, j) => (j === i ? { name: x.name, value: x.value, [field]: value } : x)) }))
      const addRow = (key) => setF((prev) => Object.assign({}, prev, { [key]: prev[key].concat([{ name: '', value: '' }]) }))
      const delRow = (key, i) => setF((prev) => Object.assign({}, prev, { [key]: prev[key].filter((x, j) => j !== i) }))
      const rows = (key, title, phName, phValue, secret) => h('div', { className: 'kb7-fgroup' },
        h('div', { className: 'kb7-fgrouptitle' }, title),
        f[key].map((p, i) => h('div', { className: 'kb7-frow', key: key + i },
          h('input', { className: 'kb7-finput', style: { maxWidth: 210 }, value: p.name, placeholder: phName, onChange: (e) => setRow(key, i, 'name', e.target.value), autoComplete: 'off', spellCheck: false }),
          h('input', { className: 'kb7-finput', type: secret === true ? 'password' : 'text', value: p.value, placeholder: phValue, onChange: (e) => setRow(key, i, 'value', e.target.value), autoComplete: 'off', spellCheck: false }),
          h('button', { type: 'button', className: 'kbcp-btn', onClick: () => delRow(key, i), 'aria-label': 'remove' }, Icon('x', 12)))),
        h('button', { type: 'button', className: 'kbcp-btn', style: { alignSelf: 'flex-start' }, onClick: () => addRow(key) }, Icon('plus', 12), ' ' + kbt('kb.cp.form.addrow')))
      const save = async () => {
        setBusy(true)
        setFerr(null)
        try {
          const body = { nom: f.nom.trim(), transport: f.transport, url: f.url.trim(), command: f.command.trim(), args: f.args, cwd: f.cwd.trim(), headers: f.headers, env: f.env, secrets: f.secrets }
          const res = await fetch('/kybernos/composio/connecteurs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          const j = await res.json().catch(() => null)
          if (res.ok !== true || j === null || j === undefined || j.ok !== true) throw new Error(j !== null && j !== undefined && j.error !== undefined && j.error !== null ? String(j.error) : 'HTTP ' + res.status)
          props.onSaved(kbt('kb.cp.form.saved'))
        } catch (e) {
          setFerr(String((e && e.message) || e))
        } finally { setBusy(false) }
      }
      const isHttp = f.transport === 'streamable-http'
      return h('div', { className: 'kb7-overlay', onClick: props.onClose },
        h('div', { className: 'kb7-modal', onClick: (e) => e.stopPropagation() },
          h('div', { className: 'kb7-mhead' },
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { className: 'kb7-mname' }, props.initial !== null && props.initial !== undefined ? kbt('kb.cp.form.edit') : kbt('kb.cp.form.title')),
              h('div', { className: 'kb7-mcat' }, 'mcp__' + (f.nom.trim().length > 0 ? f.nom.trim() : '…') + '__*')),
            h('button', { type: 'button', className: 'kbcp-btn', onClick: props.onClose, 'aria-label': kbt('kb.cp.close') }, Icon('x', 14))),
          h('div', { className: 'kb7-form' },
            h('div', null,
              h('label', { className: 'kb7-flabel' }, kbt('kb.cp.form.name')),
              h('input', { className: 'kb7-finput', value: f.nom, placeholder: 'tavily', onChange: (e) => up({ nom: e.target.value }), autoComplete: 'off', spellCheck: false })),
            h('div', null,
              h('label', { className: 'kb7-flabel' }, kbt('kb.cp.form.type')),
              h('div', { className: 'kb7-fseg' },
                h('button', { type: 'button', className: isHttp ? 'on' : '', onClick: () => up({ transport: 'streamable-http' }) }, kbt('kb.cp.form.http')),
                h('button', { type: 'button', className: isHttp === false ? 'on' : '', onClick: () => up({ transport: 'stdio' }) }, kbt('kb.cp.form.stdio')))),
            isHttp === true
              ? h('div', null,
                  h('label', { className: 'kb7-flabel' }, kbt('kb.cp.form.url')),
                  h('input', { className: 'kb7-finput', value: f.url, placeholder: 'https://mcp.tavily.com/mcp/', onChange: (e) => up({ url: e.target.value }), autoComplete: 'off', spellCheck: false }),
                  rows('headers', kbt('kb.cp.form.headers'), 'authorization', 'Bearer $TAVILY_API_KEY', false))
              : h('div', null,
                  h('label', { className: 'kb7-flabel' }, kbt('kb.cp.form.command')),
                  h('input', { className: 'kb7-finput', value: f.command, placeholder: '/opt/homebrew/bin/node', onChange: (e) => up({ command: e.target.value }), autoComplete: 'off', spellCheck: false }),
                  h('label', { className: 'kb7-flabel', style: { marginTop: 8 } }, kbt('kb.cp.form.args')),
                  h('input', { className: 'kb7-finput', value: f.args, placeholder: '/chemin/serveur.mjs --port 3000', onChange: (e) => up({ args: e.target.value }), autoComplete: 'off', spellCheck: false }),
                  h('label', { className: 'kb7-flabel', style: { marginTop: 8 } }, kbt('kb.cp.form.cwd')),
                  h('input', { className: 'kb7-finput', value: f.cwd, onChange: (e) => up({ cwd: e.target.value }), autoComplete: 'off', spellCheck: false }),
                  rows('env', kbt('kb.cp.form.env'), 'NOM', 'valeur ou $SECRET', false)),
            rows('secrets', kbt('kb.cp.form.secrets'), kbt('kb.cp.form.secretname'), kbt('kb.cp.form.secretvalue'), true),
            h('div', { className: 'kb7-fhint' }, kbt('kb.cp.form.tokenhint')),
            ferr !== null ? h('div', { className: 'kb7-ferr' }, ferr) : null,
            h('div', { className: 'kb7-actions' },
              h('button', { type: 'button', className: 'kbcp-btn primary', disabled: busy || f.nom.trim().length === 0, onClick: save }, busy === true ? kbt('kb.cp.form.saving') : kbt('kb.cp.form.save'))))))
    }

    // ── page Connections ─────────────────────────────────────────────────────
    const PAGE = 24
    const ComposioPage = (props) => {
      // Barre unifiée (gabarit 28/09) : le plugin passe KbToolbar + useToolbarState
      // en props (bundles séparés, un seul React). Sans plugin, repli gracieux sur
      // l'input + la rangée de chips d'origine — la page reste montable seule.
      const kbTools = (props !== null && props !== undefined && props.toolbar !== null && typeof props.toolbar === 'object') ? props.toolbar : null
      const kbTb = (kbTools !== null && typeof kbTools.KbToolbar === 'function' && typeof kbTools.useToolbarState === 'function') ? kbTools : null
      // Hook du plugin : la présence de kbTb est constante pour un montage donné,
      // l'ordre des hooks reste donc stable d'un rendu à l'autre.
      const tbPair = kbTb !== null ? kbTb.useToolbarState('composio', { sort: 'name', viewMode: 'cards' }) : null
      const tbState = tbPair !== null ? tbPair[0] : null
      const p1 = React.useState('')
      const p2 = React.useState('all')
      // Recherche + facette : état de la barre unifiée quand le plugin l'a passée,
      // états locaux d'origine en repli (page montée hors plugin).
      const q = tbState !== null ? String(tbState.query || '') : p1[0]
      const setQFb = p1[1]
      const chipFb = p2[0]
      const setChipFb = p2[1]
      const p3 = React.useState({})
      const conns = p3[0]
      const setConns = p3[1]
      const p4 = React.useState(false)
      const busy = p4[0]
      const setBusy = p4[1]
      const p5 = React.useState(null)
      const err = p5[0]
      const setErr = p5[1]
      const p6 = React.useState(kbCpHas())
      const hasKey = p6[0]
      const setHasKey = p6[1]
      const p7 = React.useState(null)
      const open = p7[0]
      const setOpen = p7[1]
      const p8 = React.useState(1)
      const page = p8[0]
      const setPage = p8[1]
      const p9 = React.useState(CATALOG)
      const apps = p9[0]
      const setApps = p9[1]
      const p9b = React.useState(CATALOG.length > 0)
      const ready = p9b[0]
      const setReady = p9b[1]
      const p10 = React.useState(false)
      const loadingAll = p10[0]
      const setLoadingAll = p10[1]
      // Liens OAuth en attente : { slug: url }
      const p11 = React.useState({})
      const authLinks = p11[0]
      const setAuthLinks = p11[1]
      // Connecteurs personnalisés (route host /kybernos/composio/connecteurs).
      const p12 = React.useState([])
      const cx = p12[0]
      const setCx = p12[1]
      const p13 = React.useState(null)
      const cxForm = p13[0]
      const setCxForm = p13[1]
      const p14 = React.useState(null)
      const cxNote = p14[0]
      const setCxNote = p14[1]
      // (29/09) Sous-onglet courant : « yours » (Vos connexions) par défaut,
      // « discover » (Découvrir) pour le catalogue. Aide ⓘ : repliée au repos.
      const p15 = React.useState('yours')
      const vtab = p15[0]
      const setVtab = p15[1]
      const p16 = React.useState(false)
      const helpOpen = p16[0]
      const setHelpOpen = p16[1]
      // True once the host reported that it has a key (the one the agents use): then the missing
      // browser key is not a reason to say "add your key".
      const p17 = React.useState(false)
      const hostCfg = p17[0]
      const setHostCfg = p17[1]

      const loadConnecteurs = React.useCallback(async () => {
        try {
          const res = await fetch('/kybernos/composio/connecteurs')
          const j = await res.json()
          setCx(Array.isArray(j && j.connecteurs) === true ? j.connecteurs : [])
        } catch (e) { /* la liste reste silencieuse si la route est en panne */ }
      }, [])
      React.useEffect(() => { loadConnecteurs() }, [loadConnecteurs])

      const removeConnecteur = async (nom) => {
        let ok = false
        try { ok = window.confirm(kbt('kb.cp.list.confirm')) } catch (e) { ok = false }
        if (ok !== true) return
        try {
          await fetch('/kybernos/composio/connecteurs?nom=' + encodeURIComponent(nom), { method: 'DELETE' })
          setCxNote(kbt('kb.cp.list.removed'))
        } catch (e) { /* silencieux : la liste ne casse jamais la page */ }
        loadConnecteurs()
      }

      /** Rafraîchit les connexions des apps affichées (batch list). */
      const refresh = React.useCallback(async (list, retry) => {
        setHasKey(kbCpHas())
        // Reprise OPT-IN : seul le clic Rafraîchir (:587) passe retry = true.
        // Le catalogue hôte ne dépend pas de la clé ck_, donc la reprise précède
        // le garde kbCpHas() ; le gate catOk évite tout fetch catalogue si un
        // catalogue non vide est déjà acquis.
        if (retry === true && catOk === false) {
          try {
            const fresh = await kbCpCatalog()
            // Reprise RÉUSSIE : l'erreur catalogue est levée AVANT tout retour
            // anticipé (sinon une bannière rouge survivrait au rechargement).
            setErr(null)
            // La liste d'appelant NON VIDE n'est jamais écrasée : le refetch ne
            // sert qu'à repeupler CATALOG/catOk (loadAll a pu peupler apps/conns).
            // Liste vide : on adopte la liste fraîche et on repeuple la grille,
            // comme le fait le montage.
            if (!list || list.length === 0) {
              list = fresh
              if (fresh.length > 0) setApps(fresh)
            }
          } catch (e) {
            setErr('catalogue: ' + String((e && e.message) || e))
            if (kbCpHas() === false) setConns({})
            return
          }
        }
        // La cle ck_ peut vivre côté HÔTE sans être dans le navigateur : exiger
        // kbCpHas() ici rendait « Connectées » vide alors que le compte porte
        // des connexions réelles (mesuré : 401 sans clé sur le MCP public, mais
        // la route hôte /kybernos/composio/connections répond, elle, avec
        // COMPOSIO_API_KEY). Sans clé navigateur on lit donc la route hôte.
        if (kbCpHas() === false) {
          setBusy(true)
          setErr(null)
          try {
            const sl = (list || CATALOG).map((a) => a && a.s).filter((x) => typeof x === 'string' && x.length > 0)
            if (sl.length === 0) { setConns({}); return }
            const acc = {}
            // The first failure the host reports (401, 429, timeout...) is shown: an empty list
            // that comes with an error is NOT "no app connected".
            let failure = null
            let hostKey = null
            for (let i = 0; i < sl.length; i += 40) {
              const q = sl.slice(i, i + 40).join(',')
              const r = await fetch('/kybernos/composio/connections?toolkits=' + encodeURIComponent(q))
              if (r.ok !== true) throw new Error('HTTP ' + r.status)
              const j = await r.json()
              if (j !== null && j !== undefined && j.configured === true) hostKey = true
              if (failure === null && j !== null && j !== undefined && j.configured === true && typeof j.error === 'string' && j.error.length > 0) failure = j.error
              const rows = Array.isArray(j && j.connections) ? j.connections : []
              for (const c of rows) {
                const key = String((c && c.toolkit) || '').toLowerCase()
                if (key.length === 0) continue
                const accounts = Array.isArray(c && c.accounts) ? c.accounts : []
                acc[key] = {
                  status: String((c && c.status) || '').toLowerCase(),
                  accounts: accounts.map((a) => ({
                    id: String((a && a.id) || ''),
                    label: String((a && (a.alias || a.accountType || a.id)) || ''),
                    status: String((a && a.status) || '').toUpperCase(),
                  })),
                }
              }
            }
            setConns(acc)
            setHostCfg(hostKey === true)
            if (failure !== null) setErr(kbCpErrText(failure))
          } catch (e) {
            setErr(String((e && e.message) || e))
            setConns({})
          } finally { setBusy(false) }
          return
        }
        setBusy(true)
        setErr(null)
        try {
          const slugs = (list || CATALOG).map((a) => a.s)
          const acc = {}
          for (let i = 0; i < slugs.length; i += 300) {
            Object.assign(acc, await listBatch(slugs.slice(i, i + 300)))
          }
          setConns(acc)
        } catch (e) {
          setErr(kbCpErrOf(e))
        } finally { setBusy(false) }
      }, [])
      // Le catalogue vient du host, à la demande : premier besoin = ouverture de la page.
      React.useEffect(() => {
        let alive = true
        kbCpCatalog().then((list) => {
          if (alive === false) return
          setReady(true)
          setApps((prev) => (prev.length > list.length ? prev : list))
          refresh(list)
        }).catch((e2) => { if (alive === true) { setReady(true); setErr('catalogue: ' + String((e2 && e2.message) || e2)) } })
        return () => { alive = false }
      }, [refresh])
      React.useEffect(() => {
        const on = () => { setHasKey(kbCpHas()); refresh(apps) }
        try { window.addEventListener('kbcp-key', on) } catch (e) { }
        return () => { try { window.removeEventListener('kbcp-key', on) } catch (e2) { } }
      }, [refresh, apps])

      /** Charge les 1547 apps du catalogue public Kybernos (slug+nom+catégories). */
      const loadAll = async () => {
        setLoadingAll(true)
        setErr(null)
        try {
          const r = await fetch('https://kybernos-proxy-production.up.railway.app/v1/connections/apps')
          const j = await r.json()
          const list = Array.isArray(j && j.apps) ? j.apps : []
          if (list.length === 0) throw new Error('catalogue vide')
          const merged = list.map((a) => ({ s: a.slug, n: a.name, c: a.categories || [], d: '', l: logoOf(a.slug) }))
          setApps(merged)
          setReady(true)
          refresh(merged)
        } catch (e) {
          setErr('catalogue complet indisponible: ' + String((e && e.message) || e))
        } finally { setLoadingAll(false) }
      }

      /** Connexion : crée un compte + lien OAuth (action add). */
      const connect = async (slug) => {
        setErr(null)
        setBusy(true)
        try {
          const res = await kbCpCall('COMPOSIO_MANAGE_CONNECTIONS', { toolkits: [{ name: slug, action: 'add' }] })
          const data = kbCpText(res)
          const results = data && data.data && data.data.results && typeof data.data.results === 'object'
            ? data.data.results
            : (data && data.results && typeof data.results === 'object' ? data.results : null)
          const info = results ? results[slug] : null
          // The server's redirect URL is opened in a new window: it must be http(s).
          const given = info ? (info.redirect_url || info.redirectUrl) : null
          const url = kbCpWebUrl(given) || kbCpGetLink(slug)
          if (url !== null) {
            kbCpSaveLink(slug, url)
            window.open(url, '_blank', 'noopener')
            setAuthLinks((prev) => Object.assign({}, prev, { [slug]: url }))
          } else if (typeof given === 'string' && given.length > 0) {
            setErr('Authorization link refused: it is not an http(s) address.')
          }
          // Le compte apparaît en "initializing" : on l'affiche tout de suite.
          if (info && Array.isArray(info.accounts)) {
            setConns((prev) => Object.assign({}, prev, { [slug]: { status: 'initiated', accounts: info.accounts.map((a) => ({ id: String(a.id || ''), label: accountLabel(a), status: String(a.status || '').toUpperCase() })) } }))
          }
          // Sonde jusqu'à ACTIVE (2 min 30).
          const deadline = Date.now() + 150000
          const poll = async () => {
            while (Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 5000))
              try {
                const acc = await listBatch([slug])
                setConns((prev) => Object.assign({}, prev, acc))
                const list = (acc[slug] || {}).accounts || []
                if (list.some((a) => String(a.status).toUpperCase() === 'ACTIVE')) {
                  setAuthLinks((prev) => { const n = Object.assign({}, prev); delete n[slug]; return n })
                  return
                }
              } catch (e) { }
            }
          }
          poll()
        } catch (e) {
          setErr(String((e && e.message) || e))
        } finally { setBusy(false) }
      }

      /** Supprime UN compte précis (action remove + account_id). */
      const removeAccount = async (slug, accountId) => {
        setErr(null)
        try {
          await kbCpCall('COMPOSIO_MANAGE_CONNECTIONS', { toolkits: [{ name: slug, action: 'remove', account_id: accountId }] })
          const acc = await listBatch([slug])
          setConns((prev) => Object.assign({}, prev, acc))
        } catch (e) {
          setErr('suppression: ' + String((e && e.message) || e))
        }
      }

      /** Connecteur personnalisé : ouvre le FORMULAIRE (route host). L'ancien
        * chemin conversationnel (skill) reste disponible via le chat : le draft
        * kb.cp.custom.draft est conservé dans STR. */
      const openConnectorWizard = () => {
        setCxForm({ initial: null })
      }

      const accOf = (slug) => (conns[slug] || {}).accounts || []
      const statusOf = (slug) => {
        const list = accOf(slug)
        if (list.length === 0) return null
        return list.some((a) => String(a.status).toUpperCase() === 'ACTIVE') ? 'ACTIVE' : 'PENDING'
      }
      const cats = []
      for (const a of apps) for (const c of (a.c || [])) if (cats.indexOf(c) < 0) cats.push(c)
      // Facette multi-choix côté barre, sémantique chip simple côté page : le
      // premier type coché filtre, la sélection vide vaut « Toutes » (même
      // convention que la vue Teams, qui lit aussi types[0]).
      const chip = tbState === null ? chipFb : (Array.isArray(tbState.types) === true && tbState.types.length > 0 ? String(tbState.types[0]) : 'all')
      const qn = q.trim().toLowerCase()
      const matchQuery = (a) => qn.length < 2 || a.n.toLowerCase().indexOf(qn) >= 0 || (a.d || '').toLowerCase().indexOf(qn) >= 0 || (a.c || []).some((c) => c.toLowerCase().indexOf(qn) >= 0)
      let list = apps.filter((a) => {
        if (chip === 'connected') return accOf(a.s).length > 0
        if (chip !== 'all') return (a.c || []).indexOf(chip) >= 0
        return true
      }).filter(matchQuery)
      // Sens nominal A → Z tant que dirTouched n'est pas posé (règle gabarit) ;
      // sans barre (repli hors plugin), l'ordre du catalogue est conservé.
      const cpDir = tbState !== null ? ((tbState.dirTouched === true) ? (tbState.dir === 'asc' ? 'asc' : 'desc') : 'asc') : null
      if (cpDir !== null) {
        const m = cpDir === 'asc' ? 1 : -1
        list = list.slice().sort((a, b) => String(a.n).localeCompare(String(b.n), 'fr') * m)
      }
      // Compteurs de facette calculés SUR LE RESTE des filtres (recherche seule,
      // facette type écartée) — même convention que kbFacetCounts du plugin.
      const facetPool = apps.filter(matchQuery)
      const facetOptions = [{ id: 'connected', label: kbt('kb.cp.chipconn'), count: facetPool.filter((a) => accOf(a.s).length > 0).length }]
      for (const c of cats.slice(0, 14)) facetOptions.push({ id: c, label: c, count: facetPool.filter((a) => (a.c || []).indexOf(c) >= 0).length })
      // Mise à jour de la barre : reset de la pagination dès que la recherche ou
      // la facette bougent, et pose de dirTouched dès qu'un sens est exprimé.
      const onCpUpdate = (patch) => {
        if (patch === null || typeof patch !== 'object') return
        if (patch.query !== undefined || patch.types !== undefined) setPage(1)
        if (patch.dir !== undefined) tbPair[1](Object.assign({}, patch, { dirTouched: true }))
        else tbPair[1](patch)
      }
      const pages = Math.max(1, Math.ceil(list.length / PAGE))
      const cur = Math.min(page, pages)
      const shown = list.slice((cur - 1) * PAGE, cur * PAGE)
      const totalConn = Object.values(conns).reduce((n, v) => n + ((v && v.accounts) ? v.accounts.length : 0), 0)

      const accountRow = (slug, a) => {
        const on = String(a.status).toUpperCase() === 'ACTIVE'
        return h('div', { className: 'kb7-acc', key: a.id || Math.random() },
          h('span', { style: { width: 9, height: 9, borderRadius: 5, background: on ? '#22c55e' : '#facc15', flex: 'none' } }),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { className: 'kb7-accname' }, a.label || a.id || '(compte)'),
            h('div', { className: 'kb7-accid' }, a.id),
            h('div', { className: 'kb7-accst ' + (on ? 'on' : 'pend') }, on ? kbt('kb.cp.active') : kbt('kb.cp.pend'))),
          h('button', { type: 'button', className: 'kbcp-btn', title: kbt('kb.cp.remove'), onClick: (e) => { e.stopPropagation(); removeAccount(slug, a.id) } }, Icon('trash', 13)))
      }

      const modal = () => {
        if (open === null) return null
        const a = open
        const accs = accOf(a.s)
        const link = kbCpWebUrl(authLinks[a.s]) || kbCpGetLink(a.s)
        return h('div', { className: 'kb7-overlay', onClick: () => setOpen(null) },
          h('div', { className: 'kb7-modal', onClick: (e) => e.stopPropagation() },
            h('div', { className: 'kb7-mhead' },
              AppLogo(a.s, 44),
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { className: 'kb7-mname' }, a.n),
                h('div', { className: 'kb7-mcat' }, (a.c || []).slice(0, 3).join(' · '))),
              h('button', { type: 'button', className: 'kbcp-btn', onClick: () => setOpen(null), 'aria-label': kbt('kb.cp.close') }, Icon('x', 14))),
            a.d ? h('p', { className: 'kb7-mdesc' }, a.d) : null,
            accs.length > 0
              ? h('div', null, accs.map((x) => accountRow(a.s, x)))
              : h('div', { className: 'kb7-empty', style: { padding: '10px 0' } }, kbt('kb.cp.noacc')),
            link ? h('div', { className: 'kb7-auth', style: { marginTop: 12 } },
              h('div', { className: 'kb7-authrow' }, Icon('ext', 15), kbt('kb.cp.wait')),
              h('a', { href: link, target: '_blank', rel: 'noopener', className: 'kbcp-btn primary', style: { textDecoration: 'none' } }, Icon('link', 13), kbt('kb.cp.openlink')),
              h('button', { type: 'button', className: 'kbcp-btn', title: kbt('kb.cp.dismiss'), onClick: () => { kbCpDropLink(a.s); setAuthLinks((prev) => { const n = Object.assign({}, prev); delete n[a.s]; return n }) } }, Icon('x', 13), kbt('kb.cp.dismiss'))) : null,
            h('div', { className: 'kb7-actions' },
              h('button', { type: 'button', className: 'kbcp-btn primary', disabled: busy, onClick: () => connect(a.s) }, Icon('plus', 14), kbt('kb.cp.addconn')))
          ))
      }

      // (29/09) Carte d'app partagée par « Vos connexions » et « Découvrir » —
      // un seul rendu, plus de carte clone qui dérive.
      const appCard = (a) => {
        const st = statusOf(a.s)
        const accs = accOf(a.s)
        return h('button', { type: 'button', className: 'kb7-card', key: a.s, onClick: () => setOpen(a) },
          h('div', { className: 'kb7-lr' }, AppLogo(a.s, 42),
            h('div', { style: { minWidth: 0 } },
              h('div', { className: 'kb7-name' }, a.n),
              h('div', { className: 'kb7-cat' }, (a.c || [])[0] || 'App'))),
          h('div', { className: 'kb7-desc' }, a.d || ''),
          accs.length > 0 ? h('div', { className: 'kb7-bars' }, accs.map((x, i) => h('span', { key: i, className: 'kb7-bar' + (String(x.status).toUpperCase() === 'ACTIVE' ? '' : ' pend') }))) : null,
          h('div', { className: 'kb7-foot' },
            st !== null ? h('span', { className: 'kb7-pill' + (st === 'ACTIVE' ? '' : ' pend') }, st === 'ACTIVE' ? kbt('kb.cp.connected') : kbt('kb.cp.pend')) : h('span', null),
            accs.length > 1 ? h('span', { className: 'kb7-cat' }, accs.length + ' ' + kbt('kb.cp.accounts')) : null))
      }
      // « Vos connexions » : apps reliées (au moins un compte), A → Z, sans
      // hériter de la recherche/facette propre à « Découvrir ».
      // (01/10) La barre recherche / filtre / tri est la MÊME sur les deux onglets : « Vos connexions »
      // la partage (recherche + catégorie + sens), au lieu d'ignorer tout filtre.
      const yoursPool = apps.filter((a) => accOf(a.s).length > 0)
      const yoursCats = []
      for (const a of yoursPool) for (const c of (a.c || [])) if (yoursCats.indexOf(c) < 0) yoursCats.push(c)
      const yoursChip = (chip !== 'all' && chip !== 'connected' && yoursCats.indexOf(chip) >= 0) ? chip : 'all'
      const yoursMatch = (a) => matchQuery(a) && (yoursChip === 'all' || (a.c || []).indexOf(yoursChip) >= 0)
      const yoursDir = cpDir === 'desc' ? -1 : 1
      const yoursList = yoursPool.filter(yoursMatch).slice().sort((a, b) => String(a.n).localeCompare(String(b.n), 'fr') * yoursDir)
      const yoursFacet = yoursCats.slice(0, 14).map((c) => ({ id: c, label: c, count: yoursPool.filter(matchQuery).filter((a) => (a.c || []).indexOf(c) >= 0).length }))
      const cxShown = cx.filter((c) => qn.length < 2 || String(c.nom).toLowerCase().indexOf(qn) >= 0)

      return h('div', { className: 'kb7-root' },
        h('div', { className: 'kb7-head', style: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 } },
          h('div', { style: { flex: 1, minWidth: 0 } },
            // (29/09) h2 : la page porte déjà son titre (kb6-title) — un seul
            // niveau de titre par page, l'intertitre de section reste un h2.
            h('div', { className: 'kb7-titlerow' },
              h('h2', { className: 'kb7-h1' }, kbt('kb.cp.title')),
              h('button', { type: 'button', className: 'kb7-infobtn' + (helpOpen === true ? ' on' : ''), 'aria-label': kbt('kb.cp.info'), title: kbt('kb.cp.info'), 'aria-expanded': helpOpen === true ? 'true' : 'false', 'data-kb': 'connectors-help', onClick: () => setHelpOpen(!helpOpen) }, Icon('info', 14))),
            h('p', { className: 'kb7-sub', title: kbt('kb.cp.sub') }, kbt('kb.cp.sub'))),
          // Bouton dédié, même langage visuel que « Create with AI » des autres
          // pages (classe kb-createai du bundle kybernos ; règle de repli dans
          // le CSS kb7 ci-dessous si ce bundle n'a pas inséré la sienne).
          h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'connector-create', style: { flex: 'none', height: 38, padding: '0 14px', fontSize: 13, borderRadius: 10 }, title: kbt('kb.cp.custom.hint'), 'aria-label': kbt('kb.cp.custom'), onClick: openConnectorWizard }, Icon('plus', 16), kbt('kb.cp.create'))),
        // Rangée de contrôle (maquette « Resources » 29/09) : sous-onglets en
        // pilule À GAUCHE, bloc recherche/filtres/tri À DROITE — même design
        // et même position que les autres pages, le contenu varie par onglet.
        h('div', { className: 'kb7-ctlrow' },
          h('div', { className: 'kb7-subtabs', role: 'tablist' },
            h('button', { type: 'button', role: 'tab', 'aria-selected': vtab === 'yours' ? 'true' : 'false', className: 'kb7-subtab' + (vtab === 'yours' ? ' on' : ''), 'data-kb': 'subtab-yours', onClick: () => setVtab('yours') },
              kbt('kb.cp.tab.yours'), totalConn > 0 ? h('span', { className: 'kb7-cxcount' }, String(totalConn)) : null),
            h('button', { type: 'button', role: 'tab', 'aria-selected': vtab === 'discover' ? 'true' : 'false', className: 'kb7-subtab' + (vtab === 'discover' ? ' on' : ''), 'data-kb': 'subtab-discover', onClick: () => setVtab('discover') },
              kbt('kb.cp.tab.discover'), apps.length > 0 ? h('span', { className: 'kb7-cxcount' }, String(apps.length)) : null)),
          // Barre unifiée à DROITE de la rangée (maquette) — visible sur
          // « Découvrir » seulement ; Rafraîchir / Charger tout en trailing.
          (kbTb !== null ? h(kbTb.KbToolbar, {
            state: Object.assign({}, tbState, { dir: cpDir }),
            onUpdate: onCpUpdate,
            searchPlaceholder: kbt('kb.cp.search'),
            sortOptions: [{ id: 'name', label: kbt('kbui.sort.az') }],
            facets: { type: { options: vtab === 'discover' ? facetOptions : yoursFacet } },
            total: vtab === 'discover' ? apps.length : yoursPool.length,
            shown: vtab === 'discover' ? list.length : yoursList.length,
            hideView: true,
            showFav: false,
            trailing: vtab === 'discover' ? [
              h('button', { type: 'button', key: 'refresh', className: 'kbcp-btn', disabled: busy || loadingAll, onClick: () => refresh(apps, true), title: kbt('kb.cp.refresh') }, Icon('refresh', 13)),
              apps.length <= CATALOG.length ? h('button', { type: 'button', key: 'more', className: 'kbcp-btn kb7-more', disabled: loadingAll, onClick: loadAll }, loadingAll ? kbt('kb.cp.loading') : kbt('kb.cp.loadall')) : null,
            ] : [],
          }) : null)),
        // (01/10) Les bandeaux d'état passent SOUS la rangée de contrôle : leur
        // apparition ne décale plus le titre ni la rangée (parité d'onglets).
        // (29/09) petit help « Connecteurs locaux » : replié au repos, le bouton
        // ⓘ le déplie (mêmes valeurs pour fr/en via kbt).
        helpOpen === true ? h('div', { className: 'kb7-help', role: 'note' },
          h('div', { className: 'kb7-helptitle' }, kbt('kb.cp.help.title')),
          h('p', { className: 'kb7-helptext' }, kbt('kb.cp.help'))) : null,
        (ready === true && hasKey === false && hostCfg === false && Object.keys(conns).length === 0) ? h('div', { className: 'kb7-nokey' }, Icon('key', 15), kbt('kb.cp.nokey')) : null,
        err !== null ? h('div', { className: 'kb7-err' }, err) : null,
        // ── Vos connexions ──────────────────────────────────────────────────
        vtab === 'yours' ? h('div', { className: 'kb7-panel' },
          cxNote !== null ? h('div', { className: 'kb7-fok' }, cxNote) : null,
          yoursList.length === 0
            ? (ready === true ? h('div', { className: 'kb7-emptybox' },
                h('div', { className: 'kb7-empty' }, yoursPool.length > 0 ? kbt('kb.cp.empty') : (err !== null ? err : kbt('kb.cp.yours.empty'))),
                yoursPool.length > 0 ? null : h('button', { type: 'button', className: 'kbcp-btn', onClick: () => setVtab('discover') }, kbt('kb.cp.yours.go'))) : h('div', { className: 'kb7-emptybox' }, h('div', { className: 'kb7-empty' }, kbt('kb.cp.loading'))))
            : h('div', { className: 'kb7-grid' }, yoursList.map((a) => appCard(a))),
          // Connecteurs personnalisés : liste hors catalogue, gérée par formulaire.
          h('div', { className: 'kb7-cxsec' },
            h('div', { className: 'kb7-cxtitle' }, Icon('link', 14), ' ' + kbt('kb.cp.list.title'), cx.length > 0 ? h('span', { className: 'kb7-cxcount' }, String(cx.length)) : null),
            cxShown.length === 0 ? h('div', { className: 'kb7-empty' }, cx.length === 0 ? kbt('kb.cp.list.empty') : kbt('kb.cp.empty')) : cxShown.map((c) => h('div', { className: 'kb7-cxrow', key: c.nom },
              h('span', { className: 'kb7-cxtype' + (c.transport === 'streamable-http' ? ' http' : '') }, c.transport === 'streamable-http' ? 'http' : 'stdio'),
              h('div', { style: { minWidth: 0, flex: 1 } },
                h('div', { className: 'kb7-cxname' }, c.nom),
                h('div', { className: 'kb7-cxpath' }, 'mcp__' + c.nom + '__* · ' + (c.transport === 'streamable-http' ? String(c.url || '') : [String(c.command || '')].concat(Array.isArray(c.args) === true ? c.args : []).join(' ')))),
              c.horsFormulaire === true ? h('span', { className: 'kb7-cat', style: { whiteSpace: 'nowrap' } }, kbt('kb.cp.list.offform')) : null,
              c.horsFormulaire === true ? null : h('button', { type: 'button', className: 'kbcp-btn', title: kbt('kb.cp.form.edit'), onClick: () => setCxForm({ initial: c }) }, Icon('pencil', 13)),
              h('button', { type: 'button', className: 'kbcp-btn', onClick: () => removeConnecteur(c.nom) }, Icon('trash', 13)))))
        ) : null,
        // ── Découvrir ───────────────────────────────────────────────────────
        vtab === 'discover' ? h('div', { className: 'kb7-panel' },
          // La barre unifiée vit dans la rangée de contrôle ci-dessus ;
          // repli sans plugin : champ de recherche + chips ici.
          kbTb !== null ? null : h('input', { className: 'kb7-search', value: q, placeholder: kbt('kb.cp.search'), onChange: (e) => { setQFb(e.target.value); setPage(1) } }),
          kbTb !== null ? null : h('div', { className: 'kb7-chips' },
            h('button', { type: 'button', className: 'kb7-chip' + (chip === 'all' ? ' on' : ''), onClick: () => { setChipFb('all'); setPage(1) } }, kbt('kb.cp.chipall') + ' · ' + apps.length),
            h('button', { type: 'button', className: 'kb7-chip' + (chip === 'connected' ? ' on' : ''), onClick: () => { setChipFb('connected'); setPage(1) } }, kbt('kb.cp.chipconn') + (totalConn > 0 ? ' · ' + totalConn : '')),
            cats.slice(0, 14).map((c) => h('button', { type: 'button', key: c, className: 'kb7-chip' + (chip === c ? ' on' : ''), onClick: () => { setChipFb(c); setPage(1) } }, c)),
            h('button', { type: 'button', className: 'kbcp-btn', disabled: busy || loadingAll, onClick: () => refresh(apps, true), title: kbt('kb.cp.refresh') }, Icon('refresh', 13)),
            apps.length <= CATALOG.length ? h('button', { type: 'button', className: 'kbcp-btn kb7-more', disabled: loadingAll, onClick: loadAll }, loadingAll ? kbt('kb.cp.loading') : kbt('kb.cp.loadall')) : null),
          ready === false || (busy === true && Object.keys(conns).length === 0) ? h('div', { className: 'kb7-empty' }, kbt('kb.cp.loading')) : null,
          h('div', { className: 'kb7-grid' }, shown.map((a) => appCard(a))),
          ready === true && list.length === 0 && busy === false ? h('div', { className: 'kb7-emptybox' }, h('div', { className: 'kb7-empty' }, kbt('kb.cp.empty'))) : null,
          pages > 1 ? h('div', { className: 'kb7-chips', style: { justifyContent: 'center' } },
            h('button', { type: 'button', className: 'kbcp-btn', disabled: cur <= 1, onClick: () => setPage(cur - 1) }, '‹'),
            h('span', { className: 'kb7-cat' }, cur + ' / ' + pages),
            h('button', { type: 'button', className: 'kbcp-btn', disabled: cur >= pages, onClick: () => setPage(cur + 1) }, '›')) : null,
        ) : null,
        modal(),
        cxForm !== null ? h(ConnecteurForm, {
          initial: cxForm.initial,
          onSaved: (msg) => { setCxNote(msg); setCxForm(null); loadConnecteurs() },
          onClose: () => setCxForm(null),
        }) : null)
    }

    // ── resource cards in the chat ───────────────────────────────────────────
    // The agent writes a fenced ```kybernos-carte block holding JSON: either one
    // card {slug,type,titre,desc,etat,etatLabel,actionLabel,actionUrl,note} or an
    // object {titre,items:[cards…]} for a stack. This code replaces the block with
    // a visual card, using the real Composio logo when the slug is in the
    // catalogue. Without the plugin (or on invalid JSON) the block stays a
    // readable code block: it degrades gracefully and never throws.
    // The JSON is model output, so every value is untrusted: text goes through
    // carteEsc, and the action URL through carteActionHref (http(s) or an
    // internal kb: command only, see below).
    const CARTE_LANG = 'kybernos-carte'
    const CARTE_ETATS = { ok: 1, off: 1, inconnu: 1, alerte: 1 }
    const carteEsc = (s) => String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    const carteEtat = (e) => (e !== null && typeof e === 'string' && CARTE_ETATS[e] === 1) ? e : 'inconnu'
    function carteIcône(item) {
      const slug = String(item.slug === null || item.slug === undefined ? '' : item.slug)
      if (slug !== '' && CAT_BY_SLUG[slug] !== null && CAT_BY_SLUG[slug] !== undefined && CAT_BY_SLUG[slug].l) {
        return { svg: CAT_BY_SLUG[slug].l }
      }
      const fb = item.icon || (item.type === 'skill' ? '⚡' : item.type === 'kyber' ? '🤖' : item.type === 'outil' ? '🧰' : '🔌')
      return { txt: String(fb) }
    }
    // What a card action may point to: an absolute http(s) URL, or an internal
    // `kb:` command. The click listener in carteMontre intercepts every `kb:`
    // action (`kb:accept:<text>`, `kb:<tab>`) and calls preventDefault, so those
    // never navigate. `kb:` is matched exactly as that listener matches it
    // (lowercase prefix); anything else (`javascript:`, `data:`, relative,
    // malformed, not a string) yields null and the card shows no link.
    function carteActionHref(raw) {
      if (typeof raw !== 'string') return null
      if (raw.startsWith('kb:')) return { href: raw, internal: true }
      const web = kbCpWebUrl(raw)
      return web === null ? null : { href: web, internal: false }
    }
    // The action part of a card: a link when the URL passes the rule above,
    // otherwise the label as escaped plain text (the same ghost chip a card
    // without an action shows).
    function carteActionHtml(item) {
      const link = carteActionHref(item.actionUrl)
      if (link === null) return '<span class="kbcp-carte-ghost">' + carteEsc(item.actionLabel || 'dispo') + '</span>'
      return '<a class="kbcp-carte-action" href="' + carteEsc(link.href) + '"'
        + (link.internal ? '' : ' target="_blank" rel="noreferrer noopener"') + '>'
        + carteEsc(item.actionLabel || 'Ouvrir') + '</a>'
    }
    // The whole inner HTML of a card. Pure (string in, string out), so a node
    // test can read it without a DOM.
    function carteHtml(item) {
      const etat = carteEtat(item.etat)
      const ic = carteIcône(item)
      const logoHtml = ic.svg !== undefined ? ic.svg : carteEsc(ic.txt)
      const action = carteActionHtml(item)
      const KB_CP_ICONE_GRILLE = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>'
      return '<span class="kbcp-carte-logo">' + logoHtml + '</span>' +
        '<span class="kbcp-carte-corps">' +
          '<span class="kbcp-carte-titre"><span class="kbcp-carte-nom">' + carteEsc(item.titre || 'Ressource') + '</span>' +
            (item.type ? ' <span class="kbcp-carte-type">' + carteEsc(item.type) + '</span>' : '') +
            (item.etatLabel ? ' <span class="kbcp-carte-etat kbcp-etat-' + etat + '"><span class="kbcp-carte-pt"></span>' + carteEsc(item.etatLabel) + '</span>' : '') +
          '</span>' +
          (item.desc ? '<span class="kbcp-carte-desc">' + carteEsc(item.desc) + '</span>' : '') +
          (item.note ? '<span class="kbcp-carte-note">' + carteEsc(item.note) + '</span>' : '') +
          (item.type === 'connecteur' ? '<a class="kbcp-carte-lien" href="kb:connecteurs">' + KB_CP_ICONE_GRILLE + 'Tous les connecteurs</a>' : '') +
        '</span>' + action
    }
    // Longest text a card may send with one click. A longer one is refused rather than shown
    // truncated: the confirmation must show everything that would be sent.
    const CARTE_ACCEPT_MAX = 2000
    /**
     * The click on an `kb:accept:<text>` action. Returns true when `href` is such an action (the
     * click is then handled, never navigated), after asking `confirmer(text)` with the exact text
     * that would be sent; `envoyer(text)` runs only when it answers true. Pure apart from the
     * three callbacks, so a node test can drive it.
     */
    function carteAccepter(href, confirmer, envoyer, refuser) {
      if (typeof href !== 'string' || href.slice(0, 10) !== 'kb:accept:') return false
      let texte = href.slice(10)
      try { texte = decodeURIComponent(texte) } catch (e) { /* raw when it is not encoded */ }
      if (texte.length > CARTE_ACCEPT_MAX) { if (typeof refuser === 'function') refuser(texte); return true }
      if (confirmer(texte) === true) envoyer(texte)
      return true
    }
    function carteEl(item) {
      const d = document.createElement('div')
      d.className = 'kbcp-carte'
      d.setAttribute('data-kbcp-carte', '1')
      const slug = String(item.slug === null || item.slug === undefined ? '' : item.slug)
      if (slug !== '') d.setAttribute('data-kbcp-slug', slug)
      d.innerHTML = carteHtml(item)
      return d
    }
    function carteParse(txt) {
      try {
        const j = JSON.parse(txt)
        if (Array.isArray(j)) return j.some((x) => x && typeof x === 'object' && x.titre) ? j : null
        if (j !== null && typeof j === 'object' && Array.isArray(j.items)) return j.items.some((x) => x && typeof x === 'object' && x.titre) ? j.items : null
        if (j !== null && typeof j === 'object' && j.titre) return [j]
        return null
      } catch (e) { return null }
    }
    function carteRemplace(pre, items) {
      const wrap = document.createElement('div')
      wrap.className = 'kbcp-cartes'
      wrap.setAttribute('data-kbcp-cartes', '1')
      for (const it of items) {
        if (it !== null && typeof it === 'object' && it.titre) wrap.appendChild(carteEl(it))
      }
      if (wrap.childElementCount === 0) return false
      pre.replaceWith(wrap)
      return true
    }
    function carteScanner(root) {
      const r = root || document
      // 1) structure réelle du renderer DSH : div.md-code-block avec bannière
      //    [data-code-block-banner] (texte = nom du langage + bouton Copy).
      const banners = r.querySelectorAll('[data-code-block-banner]:not([data-kbcp-fait])')
      for (const b of banners) {
        b.setAttribute('data-kbcp-fait', '1')
        // l'attribut data-code-block-banner ne vaut que "true" (drapeau) :
        // le nom du langage est dans l'infostring, sinon dans tout le texte
        // de la bannière (langage + bouton Copy).
        const info = b.querySelector('[class*="infostring"]')
        const brut = String(info !== null && info.textContent !== '' ? info.textContent : b.textContent)
        const lang = brut.replace(/copy$/i, '').trim().toLowerCase()
        if (lang !== CARTE_LANG) continue
        const block = b.closest('.md-code-block') !== null ? b.closest('.md-code-block') : b.closest('[class*="_block_"]')
        if (block === null) continue
        const code = block.querySelector('code')
        if (code === null) continue
        const items = carteParse(code.textContent || '')
        if (items === null) continue // JSON invalide : le bloc de code reste lisible
        const wrap = document.createElement('div')
        wrap.className = 'kbcp-cartes'
        wrap.setAttribute('data-kbcp-cartes', '1')
        let pose = false
        for (const it of items) {
          if (it !== null && typeof it === 'object' && it.titre) { wrap.appendChild(carteEl(it)); pose = true }
        }
        if (pose === true) block.replaceWith(wrap)
      }
      // 2) chemin générique de secours : <pre data-language> ou <code.language-*>
      const pres = r.querySelectorAll('pre:not([data-kbcp-fait])')
      for (const pre of pres) {
        pre.setAttribute('data-kbcp-fait', '1')
        const code = pre.querySelector('code')
        if (code === null) continue
        const lang = pre.getAttribute('data-language') || ((code.className.match(/language-([a-zA-Z-]+)/) || [])[1] || '')
        if (lang !== CARTE_LANG) continue
        const items = carteParse(code.textContent || '')
        if (items === null) continue // JSON invalide : le bloc de code reste lisible
        carteRemplace(pre, items)
      }
    }
    // Le catalogue charge en async : quand il arrive, repeupler les logos des
    // cartes déjà posées qui n'ont qu'un emoji en attendant leur vrai logo.
    function cartePeuplerLogos(slug) {
      const entry = CAT_BY_SLUG[slug]
      if (entry === null || entry === undefined || !entry.l) return
      const logos = document.querySelectorAll('.kbcp-carte[data-kbcp-slug="' + slug + '"] .kbcp-carte-logo')
      for (const el of logos) {
        if (el.querySelector('svg') !== null) continue
        el.innerHTML = entry.l
      }
    }
    // ── POC : pilule « Kybernos » sur la page Plugins du moteur ─────────────
    // La page Plugins (dsh-client-ui-plugin-manager, React) rend deux groupes
    // (data-plugin-group="official" / "bundles") ; chaque carte bundle porte
    // data-plugin-package. On pose une pilule dans la barre d’en-tête qui,
    // active, ne laisse visibles que les bundles @local/kybernos-* (CSS pur,
    // la classe vit sur [data-plugin-panel] — React peut re-rendre, l’état
    // survit car la pilule est ré-injectée par l’observateur).
    const KBF_STORE = 'kybernos.pluginsFilter'
    function kbfActive() {
      try { return window.localStorage.getItem(KBF_STORE) === 'on' } catch (e) { return false }
    }
    function kbfSet(on) {
      try { window.localStorage.setItem(KBF_STORE, on ? 'on' : 'off') } catch (e) { /* silencieux */ }
    }
    function kbfPoser(panel) {
      const head = panel.querySelector('header')
      if (head === null) return
      const barre = head.lastElementChild
      if (barre === null || barre.querySelector('button') === null) return
      if (barre.querySelector('.kbcp-kbfpill') !== null) {
        kbfRafraichir(panel)
        return
      }
      const n = panel.querySelectorAll('[data-plugin-group="bundles"] li[data-plugin-package^="@local/kybernos"]').length
      if (n === 0) return // pas de bundle Kybernos installé : rien à filtrer
      const pill = document.createElement('button')
      pill.type = 'button'
      pill.className = 'kbcp-kbfpill'
      pill.setAttribute('data-kb', 'kybernos-filter')
      pill.setAttribute('aria-pressed', kbfActive() ? 'true' : 'false')
      pill.title = kbt('kb.cp.kbf.help')
      pill.addEventListener('click', () => {
        const on = !kbfActive()
        kbfSet(on)
        kbfAppliquer(panel, on)
      })
      barre.insertBefore(pill, barre.firstChild)
      kbfAppliquer(panel, kbfActive())
    }
    function kbfAppliquer(panel, on) {
      panel.classList.toggle('kbcp-kbf-on', on)
      const pill = panel.querySelector('.kbcp-kbfpill')
      if (pill === null) return
      pill.classList.toggle('on', on)
      pill.setAttribute('aria-pressed', on ? 'true' : 'false')
      const n = panel.querySelectorAll('[data-plugin-group="bundles"] li[data-plugin-package^="@local/kybernos"]').length
      pill.textContent = ''
      // propre nom, pas de clé i18n : « Kybernos » est identique dans toutes
      // les langues (règle : appellations toujours en anglais).
      pill.append('Kybernos', Object.assign(document.createElement('span'), { className: 'kbcp-kbfbadge', textContent: String(n) }))
    }
    function kbfRafraichir(panel) {
      const pill = panel.querySelector('.kbcp-kbfpill')
      if (pill !== null) kbfAppliquer(panel, kbfActive())
    }
    function kbfMontre(ctx) {
      try {
        ctx.effect(() => {
          let raf = 0
          const balayer = () => {
            raf = 0
            try {
              const panel = document.querySelector('[data-plugin-panel]')
              if (panel !== null) kbfPoser(panel)
            } catch (e) { /* silencieux */ }
          }
          const planifier = () => { if (raf === 0) raf = requestAnimationFrame(balayer) }
          balayer()
          const obs = new MutationObserver(planifier)
          obs.observe(document.body, { childList: true, subtree: true })
          return () => { obs.disconnect(); if (raf !== 0) cancelAnimationFrame(raf) }
        }, 'composio: pilule Kybernos page Plugins')
      } catch (e) { }
    }
    function carteMontre(ctx) {
      try {
        ctx.effect(() => {
          let raf = 0
          const balayer = () => {
            raf = 0
            try { carteScanner(document) } catch (e) { /* silencieux : le chat ne doit jamais casser */ }
          }
          const planifier = () => { if (raf === 0) raf = requestAnimationFrame(balayer) }
          balayer()
          // actions internes « kb:<onglet> » : ouvrir la page Ressources du
          // plugin Kybernos (pont kb-open-resources) au lieu de naviguer.
          const auClic = (ev) => {
            const t = (ev.target !== null && ev.target !== undefined && typeof ev.target.closest === 'function') ? ev.target : null
            const a = (t !== null) ? t.closest('a.kbcp-carte-action') : null
            if (a === null) return
            const href = a.getAttribute('href') || ''
            // `kb:accept:<encoded text>`: the text is sent into the current conversation (bridge
            // kb-accept-text, detail.direct) AS THE USER'S MESSAGE. The card is model output (it
            // can be built from a mail the agent read), so a click on a label must not send hidden
            // text: carteAccepter shows the exact text and sends it only once it is confirmed.
            if (carteAccepter(href, (texte) => { try { return window.confirm(kbt('kb.cp.accept.confirm') + '\n\n' + texte) === true } catch (e2) { return false } },
              (texte) => { try { window.dispatchEvent(new CustomEvent('kb-accept-text', { detail: { text: texte, direct: true } })) } catch (e3) { /* silent */ } },
              () => { try { window.alert(kbt('kb.cp.accept.toolong')) } catch (e4) { /* silent */ } })) {
              ev.preventDefault()
              return
            }
            if (href.slice(0, 3) !== 'kb:') return
            ev.preventDefault()
            try { window.dispatchEvent(new CustomEvent('kb-open-resources', { detail: { tab: href.slice(3) || 'composio' } })) } catch (e) { /* silencieux */ }
          }
          document.addEventListener('click', auClic, true)
          kbCpCatalog().then(() => {
            const slugs = new Set(Array.from(document.querySelectorAll('.kbcp-carte[data-kbcp-slug]')).map((el) => el.getAttribute('data-kbcp-slug')))
            for (const s of slugs) cartePeuplerLogos(s)
          }).catch(() => { /* pas de catalogue : les emojis restent */ })
          const obs = new MutationObserver(planifier)
          obs.observe(document.body, { childList: true, subtree: true })
          return () => { obs.disconnect(); document.removeEventListener('click', auClic, true); if (raf !== 0) cancelAnimationFrame(raf) }
        }, 'composio: cartes chat')
      } catch (e) { }
    }

    // ── mount ─────────────────────────────────────────────────────────────────
    function apply(ctx) {
      localeSvc = ctx.get('locale')
      const slots = ctx.get('slots')
      try { ctx.effect(() => { const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); return () => s.remove() }, 'composio: styles') } catch (e) { }
      carteMontre(ctx)
      kbfMontre(ctx)
      slots.inject('plugins.bundle.config', () => slots.register(
        { name: 'plugins.bundle.config', key: '@local/kybernos-composio' }, ComposioKeyConfig))
    }

    return {
      inject: ['timer', 'slots', 'locale'],
      apply(ctx) { apply(ctx) },
      // exposed for the Resources tab of the kybernos bundle; the pure parts (webUrl, carteHtml,
      // carteAccepter, errText, hostState) and the MCP timeout are exposed so test-client.mjs can
      // reach them without a DOM.
      composio: { page: ComposioPage, has: kbCpHas, call: kbCpCall, text: kbCpText, parse: parseAccounts, getLink: kbCpGetLink, saveLink: kbCpSaveLink, event: 'kbcp-key', webUrl: kbCpWebUrl, carteHtml: carteHtml, carteAccepter: carteAccepter, errText: kbCpErrText, hostState: kbCpHostState, mcpTimeout: MCP_TIMEOUT },
    }
  },
})
