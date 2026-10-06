// ═══════════════════════════════════════════════════════════════════════════
// @local/kybernos-composio — client: Connections page (rich catalog,
// SVG logos, several connections per app) + key setting on the bundle page.
//
// Architecture (measured 2026-09-17):
// - The ck_ key ONLY opens the MCP connect.composio.dev/mcp (the REST backend answers 401).
// - The MCP exposes NO catalog: resources/list -> -32601, and
//   COMPOSIO_SEARCH_TOOLS only returns 4-6 tools per request. The grid is therefore built
//   on CATALOG (100 apps, 98 real SVG logos), served by the host
//   on GET /kybernos/composio/catalog and loaded on demand (catalog.js).
// - COMPOSIO_MANAGE_CONNECTIONS action "list" in a BATCH: 500 toolkits in ~760 ms,
//   with no side effect (checked twice: status "initiated", accounts [] stable).
//   It is the mechanism for discovering the connections that already exist.
// - CORS: the MCP returns `access-control-allow-origin: *` but
//   NOTIFICATIONS (no id) answer 202 WITHOUT that header -> never send
//   notifications/initialized.
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
  id: '@local/kybernos-composio',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    let localeSvc = { current: () => 'kybernos' }

    // ── Composio catalog: loaded on demand from the host ──────────────────────
    // The 412 KB of the catalog are no longer inlined in this bundle: the browser only
    // downloads them when Composio is opened. catalog.js stays the source of
    // truth, served by GET /kybernos/composio/catalog (in-memory cache on the host).
    const CATALOG_URL = '/kybernos/composio/catalog'
    let CATALOG = []
    let CAT_BY_SLUG = {}
    let catalogLoad = null
    // catOk: true ONLY after a valid, NON-EMPTY catalog has loaded.
    // A 200 + [] is a valid terminal outcome (ready -> true) but leaves
    // catOk at false: that gate is what allows the opt-in retry of refresh.
    let catOk = false
    /** Loads the catalog once (memory first), then keeps it. */
    const kbCpCatalog = () => {
      if (CATALOG.length > 0) return Promise.resolve(CATALOG)
      if (catalogLoad !== null) return catalogLoad
      catalogLoad = fetch(CATALOG_URL, { credentials: 'same-origin' })
        .then((res) => {
          if (res === null || res === undefined || res.ok !== true) throw new Error('catalog unavailable (' + String(res && res.status) + ')')
          return res.json()
        })
        .then((list) => {
          // 'invalid catalog' is reserved for a NON-array: a 200 + [] is
          // a valid terminal outcome, which resolves [] without filling CATALOG.
          if (Array.isArray(list) !== true) throw new Error('invalid catalog')
          // Valid-empty: catalogLoad is reset, otherwise the resolved promise []
          // would be served again by the check above and the retry would never refetch.
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

    // ── host calls ────────────────────────────────────────────────────────────
    // This page holds no Composio key. The host half (index.js) keeps it in the DSH .env (where the agents
    // read it), checks it with Composio, and makes every call to Composio on the page's behalf: accounts,
    // connectors, the connector test. The page only asks.
    const HOST = '/kybernos/composio'
    /** One call to the host: { status, json } (json is null when the body is not JSON). Never throws: no network is { status: 0 }. */
    const kbCpHost = async (path, method, body) => {
      try {
        const init = { method: method || 'GET', credentials: 'same-origin' }
        if (body !== undefined) { init.headers = { 'content-type': 'application/json' }; init.body = JSON.stringify(body) }
        const res = await fetch(HOST + path, init)
        let json = null
        try { json = await res.json() } catch (e) { json = null }
        return { status: res.status, json: json }
      } catch (e) { return { status: 0, json: null } }
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

    // Persistent authorization links per toolkit (reopenable until ACTIVE).
    // Composio announces a 10-minute expiry: the timestamp is stored and the
    // expired link is hidden (otherwise a dead banner would stay on screen forever).
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

    // ── catalog helpers ───────────────────────────────────────────────────────
    // CAT_BY_SLUG is (re)built when the catalog arrives (kbCpCatalog).
    const catOf = (slug) => CAT_BY_SLUG[slug] || null
    const nameOf = (slug) => { const c = catOf(slug); return c ? c.n : slug }
    const logoOf = (slug) => { const c = catOf(slug); return c ? c.l : null }

    // ── i18n ──────────────────────────────────────────────────────────────────
    const STR = {
      'composio.keysave': { fr: 'Enregistrer', en: 'Save' },
      'composio.keyclear': { fr: 'Effacer', en: 'Clear' },
      'composio.keyok': { fr: 'clé enregistrée dans ce navigateur', en: 'key saved in this browser' },
      'composio.keymissing': { fr: 'aucune clé dans ce navigateur', en: 'no key in this browser' },
      'composio.keylabel': { fr: 'Clé Composio', en: 'Composio key' },
      'composio.keynote': { fr: 'Votre clé personnelle Composio : elle pilote cet onglet ET les agents du chat. Elle reste sur cette machine ; les outils sont appelés chez Composio.', en: 'Your personal Composio key: it drives this tab AND the chat agents. It stays on this machine; the tools are called at Composio.' },
      'composio.keyhelpq': { fr: 'Comment trouver ma clé Composio ?', en: 'How do I find my Composio key?' },
      'composio.keyhelp1': { fr: 'Ouvrez dashboard.composio.dev et connectez-vous (compte gratuit).', en: 'Open dashboard.composio.dev and sign in (free account).' },
      'composio.keyhelp2': { fr: 'Menu Settings ▸ API Keys, puis Generate new key.', en: 'Menu Settings ▸ API Keys, then Generate new key.' },
      'composio.keyhelp3': { fr: 'Collez la clé (elle commence par ck_…) ci-dessus — elle reste sur votre machine.', en: 'Paste the key (it starts with ck_…) above — it stays on your machine.' },
      'composio.keyhint': { fr: "Pour que les AGENTS du chat l'utilisent aussi, copiez la même clé dans ~/.dsh/.env (COMPOSIO_API_KEY=ck_…) puis redémarrez dsh.", en: "So the CHAT agents can use it too, copy the same key into ~/.dsh/.env (COMPOSIO_API_KEY=ck_…) then restart dsh." },
      'kb.cp.title': { fr: 'Connections', en: 'Connections' },
      'kb.cp.sub': { fr: 'Les comptes par lesquels vos Kybers agissent, via Composio. Plusieurs connexions par app — une par compte, boîte ou région.', en: 'The accounts your Kybers act through, via Composio. Multiple connections per app — one per account, mailbox or region.' },
      'kb.cp.search': { fr: 'Chercher une app — Slack, GitHub, facturation…', en: 'Search an app — Slack, GitHub, billing…' },
      'kb.cp.chipall': { fr: 'Toutes', en: 'All' },
      'kb.cp.chipconn': { fr: 'Connectées', en: 'Connected' },
      // (29/09) the Plugins tab left the Resources page: Settings is the target.
      'kb.cp.nokey': { fr: "Ajoutez votre clé Composio dans Réglages → Plugins → kybernos-composio pour activer les connexions.", en: 'Add your Composio key under Settings → Plugins → kybernos-composio to enable connections.' },
      'kb.cp.connected': { fr: 'Connecté', en: 'Connected' },
      'kb.cp.pend': { fr: 'En attente', en: 'Pending' },
      'kb.cp.empty': { fr: 'Aucune app ne correspond.', en: 'No matching app.' },
      'kb.cp.openlink': { fr: 'Ouvrir la page d’autorisation', en: 'Open the authorization page' },
      'kb.cp.wait': { fr: 'Autorisation en cours — terminez dans l’onglet ouvert, puis attendez la confirmation…', en: 'Authorizing — finish in the opened tab, then wait for confirmation…' },
      'kb.cp.accounts': { fr: 'compte(s)', en: 'account(s)' },
      'kb.cp.addconn': { fr: 'Ajouter une connexion', en: 'Add a connection' },
      'kb.cp.remove': { fr: 'Supprimer', en: 'Remove' },
      'kb.cp.noacc': { fr: 'Aucun compte connecté pour cette app.', en: 'No account connected for this app.' },
      'kb.cp.loadall': { fr: 'Charger le catalogue complet', en: 'Load the full catalog' },
      'kb.cp.loading': { fr: 'Chargement…', en: 'Loading…' },
      'kb.cp.close': { fr: 'Fermer', en: 'Close' },
      'kb.cp.active': { fr: 'ACTIF', en: 'ACTIVE' },
      'kb.cp.dismiss': { fr: 'Écarter ce lien', en: 'Dismiss this link' },
      'kb.cp.create': { fr: 'Créer', en: 'Create' },
      'kb.cp.custom': { fr: 'Connecteur personnalisé', en: 'Add custom connector' },
      'kb.cp.custom.hint': { fr: 'Ajouter un serveur MCP hors catalogue — serveur HTTP distant ou commande locale (stdio).', en: 'Add an off-catalog MCP server — remote HTTP server or local command (stdio).' },
      'kb.cp.form.title': { fr: 'Nouveau connecteur', en: 'New connector' },
      'kb.cp.form.edit': { fr: 'Modifier le connecteur', en: 'Edit connector' },
      'kb.cp.form.name': { fr: 'Nom (kebab-case, ex. tavily)', en: 'Name (kebab-case, e.g. tavily)' },
      'kb.cp.form.type': { fr: 'Type de serveur', en: 'Server type' },
      'kb.cp.form.http': { fr: 'HTTP distant', en: 'Remote HTTP' },
      'kb.cp.form.stdio': { fr: 'Commande locale (stdio)', en: 'Local command (stdio)' },
      'kb.cp.form.url': { fr: 'URL du serveur MCP (https://…)', en: 'MCP server URL (https://…)' },
      'kb.cp.form.command': { fr: 'Commande — chemin ABSOLU (ex. /opt/homebrew/bin/node)', en: 'Command — absolute path (e.g. /opt/homebrew/bin/node)' },
      'kb.cp.form.args': { fr: 'Arguments (séparés par des espaces ; entre "guillemets" s’il y a un espace)', en: 'Arguments (space-separated; put "quotes" around one that has a space)' },
      'kb.cp.form.cwd': { fr: 'Répertoire de travail (optionnel)', en: 'Working directory (optional)' },
      'kb.cp.form.headers': { fr: 'En-têtes', en: 'Headers' },
      'kb.cp.form.env': { fr: "Variables d'environnement", en: 'Environment variables' },
      'kb.cp.form.secrets': { fr: 'Secrets (clés API)', en: 'Secrets (API keys)' },
      'kb.cp.form.secretname': { fr: 'NOM (ex. TAVILY_API_KEY)', en: 'NAME (e.g. TAVILY_API_KEY)' },
      'kb.cp.form.secretvalue': { fr: 'valeur — enregistrée dans ~/.dsh/.env, jamais dans la config', en: 'value — stored in ~/.dsh/.env, never in the config' },
      'kb.cp.form.tokenhint': { fr: "Astuce : dans un en-tête ou une variable, écris $NOM pour référencer le secret NOM (ex. « Bearer $TAVILY_API_KEY »).", en: 'Tip: in a header or env value, write $NAME to reference secret NAME (e.g. "Bearer $TAVILY_API_KEY").' },
      'kb.cp.form.envname': { fr: 'NOM', en: 'NAME' },
      'kb.cp.form.envvalue': { fr: 'valeur ou $SECRET', en: 'value or $SECRET' },
      'kb.cp.form.addrow': { fr: 'Ajouter une ligne', en: 'Add row' },
      'kb.cp.form.save': { fr: 'Enregistrer le connecteur', en: 'Save connector' },
      'kb.cp.form.saved': { fr: 'Connecteur enregistré — il sera actif au prochain démarrage de DSH.', en: 'Connector saved — it will be active the next time DSH starts.' },
      'kb.cp.form.saving': { fr: 'Enregistrement…', en: 'Saving…' },
      'kb.cp.list.title': { fr: 'Connecteurs personnalisés', en: 'Custom connectors' },
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
      // (POC) "Kybernos" pill of the engine's Plugins page.
      'kb.cp.kbf.help': { fr: 'Ne montrer que les plugins Kybernos (@local/kybernos-*)', en: 'Show only Kybernos plugins (@local/kybernos-*)' },
      'kb.cp.yours.go': { fr: 'Parcourir le catalogue', en: 'Browse the catalog' },
      'kb.cp.err.catalog': { fr: 'Catalogue', en: 'Catalog' },
      'kb.cp.err.fullcatalog': { fr: 'Catalogue complet indisponible', en: 'Full catalog unavailable' },
      'kb.cp.err.remove': { fr: 'Suppression impossible', en: 'Could not remove' },
      'kb.cp.err.removecx': { fr: 'Le connecteur n’a pas pu être supprimé', en: 'The connector could not be removed' },
      'kb.cp.account': { fr: '(compte)', en: '(account)' },
      'kb.cp.card.available': { fr: 'dispo', en: 'available' },
      'kb.cp.card.open': { fr: 'Ouvrir', en: 'Open' },
      'kb.cp.card.resource': { fr: 'Ressource', en: 'Resource' },
      'kb.cp.card.all': { fr: 'Tous les connecteurs', en: 'All connectors' },
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
      // (01/10) "kybernos" is the theme's DEFAULT, not a choice: with no explicit
      // language (key kybernos.theme.lang absent) and under an English shell,
      // serve English, the same policy as kybernos-plugin (kbLangActive),
      // otherwise the Resources page mixes English titles and French bodies.
      if (lang === 'kybernos') {
        try {
          if (localStorage.getItem('kybernos.theme.lang') === null && localeSvc !== null && localeSvc !== undefined && typeof localeSvc.getLocale === 'function') {
            const snap = localeSvc.getLocale()
            if (snap !== null && snap !== undefined && String(snap.active) === 'en') lang = 'en'
          }
        } catch (e) { /* storage or service unavailable: default */ }
      }
      if (lang !== 'kybernos' && lang !== 'fr') {
        const tag = lang.slice(0, 2).toLowerCase()
        if (row[tag] !== null && row[tag] !== undefined) return row[tag]
        // A locale this bundle has no text for (de, es...) gets English, not French.
        if (row.en !== null && row.en !== undefined) return row.en
      }
      return row.fr !== null && row.fr !== undefined ? row.fr : row.en
    }

    // Words people type for what a category calls something else. The search box promises "billing",
    // and no app has that word in its name, description or categories.
    const SEARCH_ALIASES = {
      billing: ['accounting', 'payment', 'tax'], invoice: ['accounting', 'payment', 'tax'], invoicing: ['accounting', 'payment', 'tax'],
      facturation: ['accounting', 'payment', 'tax'], facture: ['accounting', 'payment', 'tax'], factures: ['accounting', 'payment', 'tax'],
    }
    const kbCpSquash = (s) => String(s === null || s === undefined ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '')
    /**
     * Whether app `a` ({ s: slug, n: name, d: description, c: categories }) matches what was typed:
     * a text in the name, description or a category; the slug or the name without spaces and dashes
     * ("googlecalendar", "google-calendar"); or a word from SEARCH_ALIASES (a prefix of at least 3
     * letters) whose categories the app has. Under 2 characters everything matches. Pure.
     */
    const kbCpMatch = (a, query) => {
      const qn = String(query === null || query === undefined ? '' : query).trim().toLowerCase()
      if (qn.length < 2) return true
      const has = (s) => String(s === null || s === undefined ? '' : s).toLowerCase().indexOf(qn) >= 0
      if (has(a.n) || has(a.d) || (a.c || []).some((c) => has(c))) return true
      const sq = kbCpSquash(qn)
      if (sq.length >= 2 && (kbCpSquash(a.s).indexOf(sq) >= 0 || kbCpSquash(a.n).indexOf(sq) >= 0)) return true
      if (qn.length >= 3) {
        for (const word of Object.keys(SEARCH_ALIASES)) {
          if (word.indexOf(qn) === 0 && (a.c || []).some((c) => SEARCH_ALIASES[word].some((k) => String(c).toLowerCase().indexOf(k) >= 0))) return true
        }
      }
      return false
    }

    /**
     * The arguments list as the one text field of the form shows it: an argument with a space, a
     * quote or nothing in it is wrapped in double quotes (with \\ and \" escaped), so that the
     * host's splitArgs reads back exactly the same list. Without that a path with a space was cut in
     * two on the way back, and saving the form unchanged corrupted the connector.
     */
    const kbCpJoinArgs = (list) => list.map((a) => {
      const s = String(a)
      return s.length > 0 && /[\s'"]/.test(s) === false ? s : '"' + s.replace(/[\\"]/g, '\\$&') + '"'
    }).join(' ')

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

    // ── Lucide icons (inline SVG) ─────────────────────────────────────────────
    const LUCIDE = {
      key: ['M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-3.9-3.9L2 18Z', 'M16.5 7.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z'],
      refresh: ['M21 12a9 9 0 1 1-2.6-6.3', 'M21 3v6h-6'],
      plus: ['M12 5v14', 'M5 12h14'],
      link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
      ext: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
      trash: ['M3 6h18', 'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'],
      x: ['M18 6 6 18', 'M6 6l12 12'],
      pencil: ['M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z'],
      info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-5', 'M12 8h.01'],
    }
    const Icon = (name, size) => {
      const d = LUCIDE[name]
      if (d === null || d === undefined) return null
      return h('svg', { width: size === undefined ? 16 : size, height: size === undefined ? 16 : size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', style: { flex: 'none' } },
        d.map((p, i) => h('path', { d: p, key: i })))
    }

    // ── app logo: the real embedded SVG, initial tile as a fallback ───────────
    // Tile colours for an app with no logo. Only `cal` can reach it: it is not in the local catalog
    // but is in the full public list. (Ten more entries were here; every one of those apps has a
    // real logo in the catalog, so their tile was never drawn.)
    const APP_TILES = {
      cal: { bg: '#fff', color: '#1A73E8', border: true },
    }
    const AppLogo = (slug, size) => {
      const svg = logoOf(slug)
      if (svg) {
        return h('div', {
          className: 'kb7-applogo',
          style: { width: size, height: size, borderRadius: 10, background: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', overflow: 'hidden', border: '1px solid rgba(128,128,128,.18)' },
          // Embedded SVG (width/height removed at generation, ids prefixed).
          // The .kb7-applogo svg rule sizes it at 74 % of the container.
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
/* (Kybernos filter POC) Pill in the header bar of the engine's Plugins page
   (dsh-client-ui-plugin-manager): hides the non-Kybernos groups/cards when it is
   active. Selectors by data-plugin-*: the panel's public contract,
   stable despite the hashed classes. */
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
/* The brand colour is near white in the dark theme: the text on it is the theme's own "foreground"
   token (a fixed #fff was invisible on it). */
.kb7-chip.on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
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
/* Own class: kb7-err is also a rule of the kybernos bundle's sheet for this tab, and in the dark theme
   its fill and its text are the same red. The banner is a tint of the theme's error colour, readable on
   both; the first declarations are the fallback for a browser without color-mix. */
.kbcp-err{font-size:12px;line-height:1.5;max-width:620px;padding:9px 13px;border-radius:9px;color:var(--dsw-alias-state-error-primary,#f25a5a);background:rgba(242,90,90,.12);border:1px solid rgba(242,90,90,.35)}
@supports (color:color-mix(in srgb,red 10%,transparent)){.kbcp-err{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f25a5a) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f25a5a) 35%,transparent)}}
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
/* Fallback of the dedicated "Create with AI" button: the kybernos bundle carries the real
   .kb-createai rule; this one, scoped to this page, guarantees the same rendering
   (same colors, same shape) even when its CSS is not inserted here. */
.kb7-root .kb-createai{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border:none;border-radius:9px;background:#e5484d;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
.kb7-root .kb-createai:hover{background:#d63b40}
/* Custom connectors: list section + modal form. */
.kb7-cxsec{display:flex;flex-direction:column;gap:8px;max-width:1180px}
.kb7-cxtitle{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;margin:6px 0 0}
.kb7-cxcount{font-size:11px;font-weight:600;opacity:.6}
.kb7-cxrow{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgba(128,128,128,.25);border-radius:12px}
.kb7-cxname{font-size:13px;font-weight:600}
.kb7-cxpath{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;opacity:.55;word-break:break-all}
.kb7-cxtype{font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 8px;border-radius:999px;background:rgba(99,91,255,.16);color:#8b85ff;white-space:nowrap}
.kb7-cxtype.http{background:rgba(34,197,94,.14);color:#22c55e}
/* (29/09) Sub-tabs Yours / Discover + help (i): same language as
   kb4-tab (page tab bar), set here so the page can be mounted without the plugin. */
.kb7-titlerow{display:flex;align-items:center;gap:8px}
.kb7-infobtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:999px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;opacity:.65;cursor:pointer;flex:none}
.kb7-infobtn:hover,.kb7-infobtn.on{opacity:1;border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.kb7-help{display:flex;flex-direction:column;gap:4px;padding:12px 14px;border:1px dashed rgba(128,128,128,.4);border-radius:12px;font-size:12.5px;line-height:1.55;max-width:720px}
.kb7-helptitle{font-weight:700;font-size:12.5px}
.kb7-help .kb7-helptext{margin:0;opacity:.75}
.kb7-ctlrow{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;position:relative;min-height:44px}
/* (01/10) Loading, empty and errors ALWAYS take the same place: a box the size of the cards,
   not a bare text that makes the page jump when the data arrive. */
.kb7-emptybox{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;min-height:132px;padding:24px;border:1px dashed var(--dsw-alias-border-l2);border-radius:14px;text-align:center;max-width:1180px}
.kb7-emptybox .kb7-empty{opacity:.7}
.kb7-panel>*{max-width:1180px}
/* The search/filter bar stays on ONE line, right-aligned, under the width of the sub-tabs: never a line break
   (the search field that opens must not push the content). */
.kb7-ctlrow .kb6-toolbar{flex:1 1 0;min-width:0;display:flex;justify-content:flex-end}
.kb7-ctlrow .kb6-tb-row{flex-wrap:nowrap;justify-content:flex-end;min-width:0}
.kb7-ctlrow .kb6-tb-tools{flex-wrap:nowrap;width:auto;justify-content:flex-end}
.kb7-ctlrow .kb6-tb-tools{margin-inline-start:auto}
.kb7-ctlrow .kb6-tb-trailing{margin-inline-start:8px;gap:8px}
.kb7-ctlrow .kb6-tb-trailing:empty{display:none}
/* Sub-tabs as a pill group ("Resources" mockup 29/09): quiet container,
   active button as a raised white card, mono counter. */
.kb7-subtabs{display:inline-flex;align-items:center;gap:2px;padding:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.kb7-subtab{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 16px;border-radius:999px;font-size:13px;font-weight:600;cursor:pointer;border:0;background:transparent;color:var(--dsw-alias-label-secondary)}
.kb7-subtab:hover{color:var(--dsw-alias-label-primary)}
.kb7-subtab.on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 3px rgba(20,20,19,.14)}
.kb7-panel{display:flex;flex-direction:column;gap:12px}
.kb7-form{display:flex;flex-direction:column;gap:10px}
.kb7-flabel{font-size:11.5px;font-weight:600;opacity:.75;display:block;margin-bottom:4px}
.kb7-finput{width:100%;height:34px;border-radius:9px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;padding:0 11px;font-size:13px;box-sizing:border-box}
.kb7-frow{display:flex;gap:8px;align-items:center}
.kb7-frow .kb7-finput{flex:1;min-width:0}
.kb7-fseg{display:flex;gap:0;border:1px solid rgba(128,128,128,.3);border-radius:9px;overflow:hidden;width:max-content}
.kb7-fseg button{height:32px;padding:0 14px;border:none;background:transparent;color:inherit;font:inherit;font-size:12.5px;cursor:pointer}
.kb7-fseg button.on{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
.kb7-fgroup{border:1px dashed rgba(128,128,128,.35);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.kb7-fgrouptitle{font-size:11.5px;font-weight:700;opacity:.8}
.kb7-fhint{font-size:11px;opacity:.6;line-height:1.5}
.kb7-fok{font-size:12px;color:#22c55e}
.kb7-ferr{font-size:12px;color:#f87171}
/* ── resource cards in the chat (fenced kybernos-carte block) ──────────── */
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
/* the markdown paints its links blue (rule ._markdown_ a): double the
   specificity so the button keeps its native pair (fill + label) */
[class*="_markdown_"] a.kbcp-carte-action{color:var(--dsw-alias-label-primary-foreground,#18181b);text-decoration:none}
.kbcp-carte-ghost{flex-shrink:0;display:inline-flex;align-items:center;height:28px;padding:0 11px;border-radius:7px;border:1px solid var(--dsw-alias-border-l3,#ffffff29);color:var(--dsw-alias-label-secondary,#cfd3d6);font-size:11.5px}
`

    // ── Key config (bundle page, Plugins) ────────────────────────────────────
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
        if (val.length > 6 && val.indexOf('ck_') === 0) {
          let stored = true
          try { localStorage.setItem(KB_CP_KEY, val) } catch (e) { stored = false }
          // Storage refused: nothing is claimed saved (the panel would say "key saved" for a key that is gone on reload).
          if (stored === true) { setHas(true); setV(''); try { window.dispatchEvent(new Event('kbcp-key')) } catch (e) { } }
        }
      }
      const clear = () => { try { localStorage.removeItem(KB_CP_KEY) } catch (e) { } setHas(false); try { window.dispatchEvent(new Event('kbcp-key')) } catch (e) { } }
      const DASH = 'https://dashboard.composio.dev/'
      return h('div', { className: 'kbcp-config' },
        h('h3', null, h('span', { className: 'kbcp-logo' }, 'C'), kbt('composio.keylabel')),
        h('div', { className: 'kbcp-row' },
          h('span', { className: 'kbcp-state' },
            h('span', { className: 'kbcp-dot' + (has === true ? ' on' : '') }),
            has === true ? kbt('composio.keyok') : kbt('composio.keymissing'))),
        h('div', { className: 'kbcp-note' }, kbt('composio.keynote')),
        h('div', { className: 'kbcp-row' },
          h('input', { className: 'kbcp-input', type: 'password', value: v, placeholder: 'ck_…', onChange: (e) => setV(e.target.value), autoComplete: 'off' }),
          h('button', { type: 'button', className: 'kbcp-btn primary', onClick: save }, kbt('composio.keysave')),
          h('button', { type: 'button', className: 'kbcp-btn', onClick: clear }, kbt('composio.keyclear')),
          has === true ? h('span', { className: 'kbcp-code' }, probe === 'ok' ? 'MCP ✓' : (probe === null ? '…' : 'MCP ✗ ' + probe)) : null),
        hostState !== null ? h('div', { className: 'kbcp-row' },
          h('span', { className: 'kbcp-state', 'data-kb': 'composio-host-state' },
            h('span', { className: 'kbcp-dot' + (hostState.level === 'ok' ? ' on' : (hostState.level === 'bad' ? ' bad' : ' warn')) }),
            kbt(hostState.key))) : null,
        h('details', { className: 'kbcp-help' },
          h('summary', null, kbt('composio.keyhelpq')),
          h('ol', null,
            h('li', null, h('a', { href: DASH, target: '_blank', rel: 'noopener' }, 'dashboard.composio.dev'), ' — ', kbt('composio.keyhelp1')),
            h('li', null, kbt('composio.keyhelp2')),
            h('li', null, kbt('composio.keyhelp3')))),
        h('div', { className: 'kbcp-row' },
          h('span', { className: 'kbcp-note' }, kbt('composio.keyhint'))))
    }

    // ── "custom connector" form (talks to the host route) ────────────────────
    // The server writes the config and the .env itself: the user never sees
    // the YAML. A field value can reference a secret as $NAME.
    const EMPTY_FORM = () => ({ nom: '', transport: 'streamable-http', url: '', command: '', args: '', cwd: '', headers: [], env: [], secrets: [] })
    const ConnecteurForm = (props) => {
      const p0 = React.useState(() => {
        const it = props.initial !== null && props.initial !== undefined ? props.initial : null
        if (it === null) return EMPTY_FORM()
        return {
          nom: String(it.nom || ''), transport: it.transport === 'stdio' ? 'stdio' : 'streamable-http',
          url: String(it.url || ''), command: String(it.command || ''),
          args: Array.isArray(it.args) ? kbCpJoinArgs(it.args) : String(it.args || ''),
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
                  h('input', { className: 'kb7-finput', value: f.args, placeholder: '/path/to/server.mjs --port 3000', onChange: (e) => up({ args: e.target.value }), autoComplete: 'off', spellCheck: false }),
                  h('label', { className: 'kb7-flabel', style: { marginTop: 8 } }, kbt('kb.cp.form.cwd')),
                  h('input', { className: 'kb7-finput', value: f.cwd, onChange: (e) => up({ cwd: e.target.value }), autoComplete: 'off', spellCheck: false }),
                  rows('env', kbt('kb.cp.form.env'), kbt('kb.cp.form.envname'), kbt('kb.cp.form.envvalue'), false)),
            rows('secrets', kbt('kb.cp.form.secrets'), kbt('kb.cp.form.secretname'), kbt('kb.cp.form.secretvalue'), true),
            h('div', { className: 'kb7-fhint' }, kbt('kb.cp.form.tokenhint')),
            ferr !== null ? h('div', { className: 'kb7-ferr' }, ferr) : null,
            h('div', { className: 'kb7-actions' },
              h('button', { type: 'button', className: 'kbcp-btn primary', disabled: busy || f.nom.trim().length === 0, onClick: save }, busy === true ? kbt('kb.cp.form.saving') : kbt('kb.cp.form.save'))))))
    }

    // ── page Connections ─────────────────────────────────────────────────────
    const PAGE = 24
    const ComposioPage = (props) => {
      // Unified bar (28/09 template): the plugin passes KbToolbar + useToolbarState
      // as props (separate bundles, a single React). Without the plugin, graceful fallback to
      // the original input + chip row: the page can be mounted on its own.
      const kbTools = (props !== null && props !== undefined && props.toolbar !== null && typeof props.toolbar === 'object') ? props.toolbar : null
      const kbTb = (kbTools !== null && typeof kbTools.KbToolbar === 'function' && typeof kbTools.useToolbarState === 'function') ? kbTools : null
      // Plugin hook: whether kbTb is there is constant for a given mount,
      // so the order of the hooks stays stable from one render to the next.
      const tbPair = kbTb !== null ? kbTb.useToolbarState('composio', { sort: 'name', viewMode: 'cards' }) : null
      const tbState = tbPair !== null ? tbPair[0] : null
      const p1 = React.useState('')
      const p2 = React.useState('all')
      // Search + facet: state of the unified bar when the plugin passed it,
      // original local states as a fallback (page mounted without the plugin).
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
      // Custom connectors (host route /kybernos/composio/connecteurs).
      const p12 = React.useState([])
      const cx = p12[0]
      const setCx = p12[1]
      const p13 = React.useState(null)
      const cxForm = p13[0]
      const setCxForm = p13[1]
      const p14 = React.useState(null)
      const cxNote = p14[0]
      const setCxNote = p14[1]
      // (29/09) Current sub-tab: "yours" (Yours) by default,
      // "discover" (Discover) for the catalog. Help (i): collapsed at rest.
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
          // The host says why when its connectors file cannot be used (corrupt, unreadable).
          if (j !== null && j !== undefined && typeof j.error === 'string' && j.error.length > 0) setErr(j.error)
        } catch (e) { /* the list stays silent when the route is down */ }
      }, [])
      React.useEffect(() => { loadConnecteurs() }, [loadConnecteurs])

      const removeConnecteur = async (nom) => {
        let ok = false
        try { ok = window.confirm(kbt('kb.cp.list.confirm')) } catch (e) { ok = false }
        if (ok !== true) return
        // A refusal (409 on a corrupt sidecar, 500 when a file cannot be written) used to be shown
        // as "Connector removed": the answer is read now.
        setErr(null)
        try {
          const res = await fetch('/kybernos/composio/connecteurs?nom=' + encodeURIComponent(nom), { method: 'DELETE' })
          const j = await res.json().catch(() => null)
          if (res.ok !== true || j === null || j === undefined || j.ok !== true) {
            setCxNote(null)
            setErr(kbt('kb.cp.err.removecx') + (j !== null && j !== undefined && typeof j.error === 'string' ? ' — ' + j.error : ' (HTTP ' + res.status + ')'))
          } else setCxNote(kbt('kb.cp.list.removed'))
        } catch (e) {
          setCxNote(null)
          setErr(kbt('kb.cp.err.removecx') + ' — ' + String((e && e.message) || e))
        }
        loadConnecteurs()
      }

      /** Refreshes the connections of the apps shown (batch list). */
      const refresh = React.useCallback(async (list, retry) => {
        setHasKey(kbCpHas())
        // OPT-IN retry: only the Refresh click passes retry = true.
        // The host catalog does not depend on the ck_ key, so the retry comes before
        // the kbCpHas() guard; the catOk gate avoids any catalog fetch when a
        // non-empty catalog is already held.
        if (retry === true && catOk === false) {
          try {
            const fresh = await kbCpCatalog()
            // SUCCESSFUL retry: the catalog error is cleared BEFORE any early
            // return (otherwise a red banner would survive the reload).
            setErr(null)
            // A NON-EMPTY caller list is never overwritten: the refetch only
            // serves to refill CATALOG/catOk (loadAll may have filled apps/conns).
            // Empty list: the fresh list is adopted and the grid refilled,
            // as the mount does.
            if (!list || list.length === 0) {
              list = fresh
              if (fresh.length > 0) setApps(fresh)
            }
          } catch (e) {
            setErr(kbt('kb.cp.err.catalog') + ': ' + String((e && e.message) || e))
            if (kbCpHas() === false) setConns({})
            return
          }
        }
        // The ck_ key can live on the HOST without being in the browser: requiring
        // kbCpHas() here left "Connected" empty while the account holds
        // real connections (measured: 401 without a key on the public MCP, but
        // the host route /kybernos/composio/connections answers, with
        // COMPOSIO_API_KEY). Without a browser key the host route is read.
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
      // The catalog comes from the host, on demand: first need = opening the page.
      React.useEffect(() => {
        let alive = true
        kbCpCatalog().then((list) => {
          if (alive === false) return
          setReady(true)
          setApps((prev) => (prev.length > list.length ? prev : list))
          refresh(list)
        }).catch((e2) => { if (alive === true) { setReady(true); setErr(kbt('kb.cp.err.catalog') + ': ' + String((e2 && e2.message) || e2)) } })
        return () => { alive = false }
      }, [refresh])
      React.useEffect(() => {
        const on = () => { setHasKey(kbCpHas()); refresh(apps) }
        try { window.addEventListener('kbcp-key', on) } catch (e) { }
        return () => { try { window.removeEventListener('kbcp-key', on) } catch (e2) { } }
      }, [refresh, apps])

      /** Loads the apps of the public Kybernos catalog (slug + name + categories). */
      const loadAll = async () => {
        setLoadingAll(true)
        setErr(null)
        try {
          const r = await fetch('https://kybernos-proxy-production.up.railway.app/v1/connections/apps')
          const j = await r.json()
          const list = Array.isArray(j && j.apps) ? j.apps : []
          if (list.length === 0) throw new Error('empty catalog')
          // Whatever the list holds, an entry gets a string name and string categories: a missing
          // name or an object in `categories` would throw in the search and in the facets.
          const merged = list.filter((a) => a !== null && typeof a === 'object' && typeof a.slug === 'string' && a.slug.length > 0)
            .map((a) => ({ s: a.slug, n: String(a.name || a.slug), c: Array.isArray(a.categories) ? a.categories.filter((x) => typeof x === 'string') : [], d: '', l: logoOf(a.slug) }))
          setApps(merged)
          setReady(true)
          refresh(merged)
        } catch (e) {
          setErr(kbt('kb.cp.err.fullcatalog') + ': ' + String((e && e.message) || e))
        } finally { setLoadingAll(false) }
      }

      /** Connect: creates an account + OAuth link (action add). */
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
          // The account shows up as "initializing": it is displayed right away.
          if (info && Array.isArray(info.accounts)) {
            setConns((prev) => Object.assign({}, prev, { [slug]: { status: 'initiated', accounts: info.accounts.map((a) => ({ id: String(a.id || ''), label: accountLabel(a), status: String(a.status || '').toUpperCase() })) } }))
          }
          // Probe until ACTIVE (2 min 30).
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
          setErr(kbCpErrOf(e))
        } finally { setBusy(false) }
      }

      /** Removes ONE given account (action remove + account_id). */
      const removeAccount = async (slug, accountId) => {
        setErr(null)
        try {
          await kbCpCall('COMPOSIO_MANAGE_CONNECTIONS', { toolkits: [{ name: slug, action: 'remove', account_id: accountId }] })
          const acc = await listBatch([slug])
          setConns((prev) => Object.assign({}, prev, acc))
        } catch (e) {
          setErr(kbt('kb.cp.err.remove') + ': ' + kbCpErrOf(e))
        }
      }

      /** Custom connector: opens the FORM (host route). The old conversational
        * path (skill) stays available through the chat. */
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
      // Multi-choice facet on the bar side, single-chip semantics on the page side: the
      // first type ticked filters, an empty selection means "All" (same
      // convention as the Teams view, which also reads types[0]).
      const chip = tbState === null ? chipFb : (Array.isArray(tbState.types) === true && tbState.types.length > 0 ? String(tbState.types[0]) : 'all')
      const qn = q.trim().toLowerCase()
      const matchQuery = (a) => kbCpMatch(a, qn)
      let list = apps.filter((a) => {
        if (chip === 'connected') return accOf(a.s).length > 0
        if (chip !== 'all') return (a.c || []).indexOf(chip) >= 0
        return true
      }).filter(matchQuery)
      // Nominal A -> Z direction until dirTouched is set (template rule);
      // without a bar (fallback outside the plugin), the catalog order is kept.
      const cpDir = tbState !== null ? ((tbState.dirTouched === true) ? (tbState.dir === 'asc' ? 'asc' : 'desc') : 'asc') : null
      if (cpDir !== null) {
        const m = cpDir === 'asc' ? 1 : -1
        list = list.slice().sort((a, b) => String(a.n).localeCompare(String(b.n), 'fr') * m)
      }
      // Facet counters computed ON THE REST of the filters (search only,
      // type facet set aside): same convention as the plugin's kbFacetCounts.
      const facetPool = apps.filter(matchQuery)
      const facetOptions = [{ id: 'connected', label: kbt('kb.cp.chipconn'), count: facetPool.filter((a) => accOf(a.s).length > 0).length }]
      for (const c of cats.slice(0, 14)) facetOptions.push({ id: c, label: c, count: facetPool.filter((a) => (a.c || []).indexOf(c) >= 0).length })
      // Bar update: pagination reset as soon as the search or the facet moves,
      // and dirTouched set as soon as a direction is expressed.
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
            h('div', { className: 'kb7-accname' }, a.label || a.id || kbt('kb.cp.account')),
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

      // (29/09) App card shared by "Yours" and "Discover":
      // one single rendering, no clone card that drifts.
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
      // "Yours": linked apps (at least one account), A -> Z, without
      // inheriting the search/facet that belongs to "Discover".
      // (01/10) The search / filter / sort bar is the SAME on both tabs: "Yours"
      // shares it (search + category + direction), instead of ignoring every filter.
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
            // (29/09) h2: the page already carries its title (kb6-title): a single
            // heading level per page, the section subtitle stays an h2.
            h('div', { className: 'kb7-titlerow' },
              h('h2', { className: 'kb7-h1' }, kbt('kb.cp.title')),
              h('button', { type: 'button', className: 'kb7-infobtn' + (helpOpen === true ? ' on' : ''), 'aria-label': kbt('kb.cp.info'), title: kbt('kb.cp.info'), 'aria-expanded': helpOpen === true ? 'true' : 'false', 'data-kb': 'connectors-help', onClick: () => setHelpOpen(!helpOpen) }, Icon('info', 14))),
            h('p', { className: 'kb7-sub', title: kbt('kb.cp.sub') }, kbt('kb.cp.sub'))),
          // Dedicated button, same visual language as "Create with AI" on the other
          // pages (class kb-createai of the kybernos bundle; fallback rule in
          // the kb7 CSS below if that bundle has not inserted its own).
          h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'connector-create', style: { flex: 'none', height: 38, padding: '0 14px', fontSize: 13, borderRadius: 10 }, title: kbt('kb.cp.custom.hint'), 'aria-label': kbt('kb.cp.custom'), onClick: openConnectorWizard }, Icon('plus', 16), kbt('kb.cp.create'))),
        // Control row ("Resources" mockup 29/09): pill sub-tabs on the LEFT,
        // search/filters/sort block on the RIGHT: same design
        // and same position as the other pages, the content varies by tab.
        h('div', { className: 'kb7-ctlrow' },
          h('div', { className: 'kb7-subtabs', role: 'tablist' },
            h('button', { type: 'button', role: 'tab', 'aria-selected': vtab === 'yours' ? 'true' : 'false', className: 'kb7-subtab' + (vtab === 'yours' ? ' on' : ''), 'data-kb': 'subtab-yours', onClick: () => setVtab('yours') },
              kbt('kb.cp.tab.yours'), totalConn > 0 ? h('span', { className: 'kb7-cxcount' }, String(totalConn)) : null),
            h('button', { type: 'button', role: 'tab', 'aria-selected': vtab === 'discover' ? 'true' : 'false', className: 'kb7-subtab' + (vtab === 'discover' ? ' on' : ''), 'data-kb': 'subtab-discover', onClick: () => setVtab('discover') },
              kbt('kb.cp.tab.discover'), apps.length > 0 ? h('span', { className: 'kb7-cxcount' }, String(apps.length)) : null)),
          // Unified bar on the RIGHT of the row (mockup): visible on
          // "Discover" only; Refresh / Load all as trailing items.
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
        // (01/10) The status banners go UNDER the control row: their
        // appearance no longer moves the title or the row (tab parity).
        // (29/09) small "Local Connectors" help: collapsed at rest, the (i) button
        // unfolds it (same values for fr/en through kbt).
        helpOpen === true ? h('div', { className: 'kb7-help', role: 'note' },
          h('div', { className: 'kb7-helptitle' }, kbt('kb.cp.help.title')),
          h('p', { className: 'kb7-helptext' }, kbt('kb.cp.help'))) : null,
        (ready === true && hasKey === false && hostCfg === false && Object.keys(conns).length === 0) ? h('div', { className: 'kb7-nokey' }, Icon('key', 15), kbt('kb.cp.nokey')) : null,
        err !== null ? h('div', { className: 'kbcp-err', role: 'alert' }, err) : null,
        // ── Vos connexions ──────────────────────────────────────────────────
        vtab === 'yours' ? h('div', { className: 'kb7-panel' },
          cxNote !== null ? h('div', { className: 'kb7-fok' }, cxNote) : null,
          yoursList.length === 0
            ? (ready === true ? h('div', { className: 'kb7-emptybox' },
                h('div', { className: 'kb7-empty' }, yoursPool.length > 0 ? kbt('kb.cp.empty') : (err !== null ? err : kbt('kb.cp.yours.empty'))),
                yoursPool.length > 0 ? null : h('button', { type: 'button', className: 'kbcp-btn', onClick: () => setVtab('discover') }, kbt('kb.cp.yours.go'))) : h('div', { className: 'kb7-emptybox' }, h('div', { className: 'kb7-empty' }, kbt('kb.cp.loading'))))
            : h('div', { className: 'kb7-grid' }, yoursList.map((a) => appCard(a))),
          // Custom connectors: off-catalog list, managed by the form.
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
        // ── Discover ────────────────────────────────────────────────────────
        vtab === 'discover' ? h('div', { className: 'kb7-panel' },
          // The unified bar lives in the control row above;
          // fallback without the plugin: search field + chips here.
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
    function carteIcon(item) {
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
      if (link === null) return '<span class="kbcp-carte-ghost">' + carteEsc(item.actionLabel || kbt('kb.cp.card.available')) + '</span>'
      return '<a class="kbcp-carte-action" href="' + carteEsc(link.href) + '"'
        + (link.internal ? '' : ' target="_blank" rel="noreferrer noopener"') + '>'
        + carteEsc(item.actionLabel || kbt('kb.cp.card.open')) + '</a>'
    }
    // The whole inner HTML of a card. Pure (string in, string out), so a node
    // test can read it without a DOM.
    function carteHtml(item) {
      const etat = carteEtat(item.etat)
      const ic = carteIcon(item)
      const logoHtml = ic.svg !== undefined ? ic.svg : carteEsc(ic.txt)
      const action = carteActionHtml(item)
      const KB_CP_ICONE_GRILLE = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>'
      return '<span class="kbcp-carte-logo">' + logoHtml + '</span>' +
        '<span class="kbcp-carte-corps">' +
          '<span class="kbcp-carte-titre"><span class="kbcp-carte-nom">' + carteEsc(item.titre || kbt('kb.cp.card.resource')) + '</span>' +
            (item.type ? ' <span class="kbcp-carte-type">' + carteEsc(item.type) + '</span>' : '') +
            (item.etatLabel ? ' <span class="kbcp-carte-etat kbcp-etat-' + etat + '"><span class="kbcp-carte-pt"></span>' + carteEsc(item.etatLabel) + '</span>' : '') +
          '</span>' +
          (item.desc ? '<span class="kbcp-carte-desc">' + carteEsc(item.desc) + '</span>' : '') +
          (item.note ? '<span class="kbcp-carte-note">' + carteEsc(item.note) + '</span>' : '') +
          (item.type === 'connecteur' ? '<a class="kbcp-carte-lien" href="kb:connecteurs">' + KB_CP_ICONE_GRILLE + carteEsc(kbt('kb.cp.card.all')) + '</a>' : '') +
        '</span>' + action
    }
    // Longest text a card may send with one click. A longer one is refused rather than shown
    // truncated: the confirmation must show everything that would be sent. 500 is the bound of the
    // kb-accept-text listener in @local/kybernos-plugin, which drops anything longer: a higher limit here
    // would let the user confirm a message that is then never sent.
    const CARTE_ACCEPT_MAX = 500
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
      // 1) real structure of the DSH renderer: div.md-code-block with a banner
      //    [data-code-block-banner] (text = language name + Copy button).
      const banners = r.querySelectorAll('[data-code-block-banner]:not([data-kbcp-fait])')
      for (const b of banners) {
        b.setAttribute('data-kbcp-fait', '1')
        // the data-code-block-banner attribute is only "true" (a flag):
        // the language name is in the infostring, otherwise in the whole text
        // of the banner (language + Copy button).
        const info = b.querySelector('[class*="infostring"]')
        const brut = String(info !== null && info.textContent !== '' ? info.textContent : b.textContent)
        const lang = brut.replace(/copy$/i, '').trim().toLowerCase()
        if (lang !== CARTE_LANG) continue
        const block = b.closest('.md-code-block') !== null ? b.closest('.md-code-block') : b.closest('[class*="_block_"]')
        if (block === null) continue
        const code = block.querySelector('code')
        if (code === null) continue
        const items = carteParse(code.textContent || '')
        if (items === null) continue // invalid JSON: the code block stays readable
        const wrap = document.createElement('div')
        wrap.className = 'kbcp-cartes'
        wrap.setAttribute('data-kbcp-cartes', '1')
        let pose = false
        for (const it of items) {
          if (it !== null && typeof it === 'object' && it.titre) { wrap.appendChild(carteEl(it)); pose = true }
        }
        if (pose === true) block.replaceWith(wrap)
      }
      // 2) generic fallback path: <pre data-language> or <code.language-*>
      const pres = r.querySelectorAll('pre:not([data-kbcp-fait])')
      for (const pre of pres) {
        pre.setAttribute('data-kbcp-fait', '1')
        const code = pre.querySelector('code')
        if (code === null) continue
        const lang = pre.getAttribute('data-language') || ((code.className.match(/language-([a-zA-Z-]+)/) || [])[1] || '')
        if (lang !== CARTE_LANG) continue
        const items = carteParse(code.textContent || '')
        if (items === null) continue // invalid JSON: the code block stays readable
        carteRemplace(pre, items)
      }
    }
    // The catalog loads asynchronously: when it arrives, fill in the logos of the
    // cards already placed that only have an emoji while waiting for their real logo.
    function cartePeuplerLogos(slug) {
      const entry = CAT_BY_SLUG[slug]
      if (entry === null || entry === undefined || !entry.l) return
      const logos = document.querySelectorAll('.kbcp-carte[data-kbcp-slug="' + slug + '"] .kbcp-carte-logo')
      for (const el of logos) {
        if (el.querySelector('svg') !== null) continue
        el.innerHTML = entry.l
      }
    }
    // ── POC: "Kybernos" pill on the engine's Plugins page ───────────────────
    // The Plugins page (dsh-client-ui-plugin-manager, React) renders two groups
    // (data-plugin-group="official" / "bundles"); each bundle card carries
    // data-plugin-package. A pill is placed in the header bar that, when
    // active, leaves only the @local/kybernos-* bundles visible (pure CSS,
    // the class lives on [data-plugin-panel]: React can re-render, the state
    // survives because the pill is re-injected by the observer).
    const KBF_STORE = 'kybernos.pluginsFilter'
    function kbfActive() {
      try { return window.localStorage.getItem(KBF_STORE) === 'on' } catch (e) { return false }
    }
    function kbfSet(on) {
      try { window.localStorage.setItem(KBF_STORE, on ? 'on' : 'off') } catch (e) { /* silent */ }
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
      if (n === 0) return // no Kybernos bundle installed: nothing to filter
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
      // own name, no i18n key: "Kybernos" is the same in every
      // language (rule: product names always in English).
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
            } catch (e) { /* silent */ }
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
            try { carteScanner(document) } catch (e) { /* silent: the chat must never break */ }
          }
          const planifier = () => { if (raf === 0) raf = requestAnimationFrame(balayer) }
          balayer()
          // internal actions "kb:<tab>": open the Resources page of the
          // Kybernos plugin (bridge kb-open-resources) instead of navigating.
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
            try { window.dispatchEvent(new CustomEvent('kb-open-resources', { detail: { tab: href.slice(3) || 'composio' } })) } catch (e) { /* silent */ }
          }
          document.addEventListener('click', auClic, true)
          kbCpCatalog().then(() => {
            const slugs = new Set(Array.from(document.querySelectorAll('.kbcp-carte[data-kbcp-slug]')).map((el) => el.getAttribute('data-kbcp-slug')))
            for (const s of slugs) cartePeuplerLogos(s)
          }).catch(() => { /* no catalog: the emojis stay */ })
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
      // AGENTS.md rule 2: a bundle must never stop DSH from starting. The effects inside are guarded one by one;
      // this net catches whatever else (a missing service) so the failure only costs this bundle's UI.
      apply(ctx) { try { apply(ctx) } catch (e) { try { console.error('[kybernos-composio] client not mounted', e) } catch (e2) { /* console unavailable */ } } },
      // exposed for the Resources tab of the kybernos bundle; the pure parts (webUrl, carteHtml,
      // carteAccepter, errText, hostState) and the MCP timeout are exposed so test-client.mjs can
      // reach them without a DOM.
      composio: { page: ComposioPage, has: kbCpHas, call: kbCpCall, text: kbCpText, parse: parseAccounts, getLink: kbCpGetLink, saveLink: kbCpSaveLink, event: 'kbcp-key', webUrl: kbCpWebUrl, carteHtml: carteHtml, carteAccepter: carteAccepter, carteAcceptMax: CARTE_ACCEPT_MAX, match: kbCpMatch, joinArgs: kbCpJoinArgs, t: kbt, errText: kbCpErrText, hostState: kbCpHostState, mcpTimeout: MCP_TIMEOUT },
    }
  },
})
