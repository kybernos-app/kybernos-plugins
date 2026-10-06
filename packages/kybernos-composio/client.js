// ═══════════════════════════════════════════════════════════════════════════
// @local/kybernos-composio — client: Connections page (rich catalog, SVG logos,
// several connections per app, the person's own MCP servers) + the key panel
// on the bundle page.
//
// Architecture:
// - This page holds NO Composio key and makes no call to Composio. The host half
//   (index.js) keeps the key in the DSH .env (the file the agents read), checks it
//   with Composio, lists and adds accounts, writes the MCP servers into the
//   profile and tests them. The page asks the host (kbCpHost) and shows the answer.
// - The grid is built on CATALOG (100 apps, 98 real SVG logos), served by the host
//   on GET /kybernos/composio/catalog and loaded on demand (catalog.js): Composio's
//   MCP exposes no catalog (resources/list -> -32601, and COMPOSIO_SEARCH_TOOLS only
//   returns 4-6 tools per request). The accounts already connected come from
//   GET /connections, which asks Composio in batches (measured: 500 toolkits in
//   about 760 ms, no side effect).
// - DSH reloads cordis.patch.yml by itself a couple of seconds after the host
//   writes it (measured), so a saved MCP server needs no restart: the row shows
//   what DSH says of it (loaded, how many tools) and asks again while it loads.
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
      'composio.keylabel': { fr: 'Clé Composio', en: 'Composio key' },
      'composio.keynote': { fr: 'Votre clé personnelle Composio : elle pilote cet onglet ET les agents du chat. Elle reste sur cette machine (~/.dsh/.env) ; les outils sont appelés chez Composio.', en: 'Your personal Composio key: it drives this tab AND the chat agents. It stays on this machine (~/.dsh/.env); the tools are called at Composio.' },
      'composio.keyhelpq': { fr: 'Comment trouver ma clé Composio ?', en: 'How do I find my Composio key?' },
      'composio.keyhelp1': { fr: 'Ouvrez dashboard.composio.dev et connectez-vous (compte gratuit).', en: 'Open dashboard.composio.dev and sign in (free account).' },
      'composio.keyhelp2': { fr: 'Menu Settings ▸ API Keys, puis Generate new key.', en: 'Menu Settings ▸ API Keys, then Generate new key.' },
      'composio.keyhelp3': { fr: 'Collez la clé (elle commence par ck_…) ci-dessus : elle est enregistrée sur votre machine.', en: 'Paste the key (it starts with ck_…) above: it is saved on your machine.' },
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
      'kb.cp.form.saved': { fr: 'Serveur enregistré. DSH le charge dans quelques secondes.', en: 'Server saved. DSH loads it in a few seconds.' },
      'kb.cp.form.saving': { fr: 'Enregistrement…', en: 'Saving…' },
      'kb.cp.refresh': { fr: 'Rafraîchir', en: 'Refresh' },
      'kbui.sort.az': { fr: 'A → Z', en: 'A → Z' },
      // (29/09) sous-onglets + aide « Connecteurs locaux ».
      'kb.cp.tab.yours': { fr: 'Vos connexions', en: 'Yours' },
      'kb.cp.tab.discover': { fr: 'Découvrir', en: 'Discover' },
      'kb.cp.info': { fr: 'À propos des connecteurs locaux', en: 'About Local Connectors' },
      'kb.cp.help.title': { fr: 'Connecteurs locaux — mode d’emploi', en: 'Local Connectors — how it works' },
      'kb.cp.help': { fr: 'Vos connexions : les apps déjà reliées à vos Kybers. Découvrir : le catalogue complet, connexion en un clic. Serveurs MCP : vos propres serveurs (HTTP distant ou commande locale). Les agents du chat lisent la même clé côté machine (~/.dsh/.env).', en: 'Yours: apps already linked to your Kybers. Discover: the full catalog, one-click connect. MCP servers: your own servers (remote HTTP or local command). Chat agents read the same key on this machine (~/.dsh/.env).' },
      'kb.cp.yours.empty': { fr: 'Aucune app connectée pour l’instant — le catalogue vous attend.', en: 'No app connected yet — the catalog is waiting for you.' },
      // (POC) "Kybernos" pill of the engine's Plugins page.
      'kb.cp.kbf.help': { fr: 'Ne montrer que les plugins Kybernos (@local/kybernos-*)', en: 'Show only Kybernos plugins (@local/kybernos-*)' },
      'kb.cp.yours.go': { fr: 'Parcourir le catalogue', en: 'Browse the catalog' },
      'kb.cp.err.catalog': { fr: 'Catalogue', en: 'Catalog' },
      'kb.cp.err.fullcatalog': { fr: 'Catalogue complet indisponible', en: 'Full catalog unavailable' },
      'kb.cp.err.remove': { fr: 'Suppression impossible', en: 'Could not remove' },
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
      'kb.cp.err.gateway': { fr: 'Composio a un souci passager ({code}) : réessayez dans un instant.', en: 'Composio has a passing problem ({code}): try again in a moment.' },
      // Key panel: what the HOST (the agents) sees, as opposed to this browser.
      // Card button that sends text into the conversation: the text is shown first.
      'kb.cp.accept.confirm': { fr: 'Envoyer ce message dans la conversation ?', en: 'Send this message in the conversation?' },
      'kb.cp.accept.toolong': { fr: 'Ce message est trop long pour être envoyé d’un clic : il n’a pas été envoyé.', en: 'This message is too long to send with one click: it was not sent.' },
      // ── key panel: what is saved, whether Composio accepts it, whether the agents hold it ──
      'composio.keyset': { fr: 'Clé enregistrée sur cette machine', en: 'Key saved on this machine' },
      'composio.keyunset': { fr: 'Aucune clé enregistrée', en: 'No key saved' },
      'composio.keyenv': { fr: 'Clé fournie par l’environnement de lancement de DSH (à changer là-bas)', en: 'Key provided by the environment DSH was started with (change it there)' },
      'composio.accepted': { fr: 'Composio l’accepte', en: 'Composio accepts it' },
      'composio.rejected': { fr: 'Composio refuse cette clé', en: 'Composio rejects this key' },
      'composio.unchecked': { fr: 'Composio ne répond pas bien : clé non vérifiée', en: 'Composio is not answering well: key not checked' },
      'composio.agentsSame': { fr: 'Les agents du chat l’utilisent', en: 'The chat agents use it' },
      'composio.agentsLater': { fr: 'Les agents du chat l’utiliseront après un redémarrage de DSH', en: 'The chat agents will use it after DSH restarts' },
      'composio.hostunknown': { fr: 'État de la clé inconnu : le plugin hôte ne répond pas. S’il vient d’être mis à jour, redémarrez DSH.', en: 'Key state unknown: the host plugin does not answer. If it was just updated, restart DSH.' },
      'kb.cp.hostold': { fr: 'Le plugin hôte tourne encore dans sa version précédente : redémarrez DSH pour activer les nouveautés. En attendant, la liste est en lecture seule.', en: 'The host plugin is still running its previous version: restart DSH to activate the changes. Meanwhile the list is read only.' },
      'composio.migrate': { fr: 'Une clé de l’ancienne version est dans ce navigateur. L’enregistrer sur cette machine ?', en: 'A key from the previous version is in this browser. Save it on this machine?' },
      'composio.err.invalid': { fr: 'Une clé Composio commence par ck_ et ne contient pas d’espace.', en: 'A Composio key starts with ck_ and has no spaces.' },
      'composio.err.rejected': { fr: 'Composio a refusé cette clé : elle n’a pas été enregistrée.', en: 'Composio rejected this key: it was not saved.' },
      'composio.err.inherited': { fr: 'La clé vient de l’environnement de lancement de DSH : changez-la là-bas.', en: 'The key comes from the environment DSH was started with: change it there.' },
      'composio.err.write': { fr: 'La clé n’a pas pu être enregistrée.', en: 'The key could not be saved.' },
      'composio.saved': { fr: 'Clé enregistrée. Les agents l’utiliseront après un redémarrage de DSH.', en: 'Key saved. The agents will use it after DSH restarts.' },
      'composio.savedlive': { fr: 'Clé enregistrée.', en: 'Key saved.' },
      'composio.savedunchecked': { fr: 'Clé enregistrée, mais Composio ne répond pas : elle n’a pas pu être vérifiée.', en: 'Key saved, but Composio does not answer: it could not be checked.' },
      // ── the MCP servers tab ──
      'kb.cp.tab.mcp': { fr: 'Serveurs MCP', en: 'MCP servers' },
      'kb.cp.add': { fr: 'Ajouter un serveur MCP', en: 'Add an MCP server' },
      'kb.cp.add.form': { fr: 'Remplir un formulaire', en: 'Fill in a form' },
      'kb.cp.add.formhint': { fr: 'HTTP distant ou commande locale', en: 'Remote HTTP or local command' },
      'kb.cp.add.json': { fr: 'Coller du JSON', en: 'Paste JSON' },
      'kb.cp.add.jsonhint': { fr: 'Le bloc « mcpServers » d’une documentation', en: 'The "mcpServers" block of a documentation page' },
      'kb.cp.mcp.empty': { fr: 'Aucun serveur MCP. Ajoutez-en un avec un formulaire ou en collant du JSON.', en: 'No MCP server yet. Add one with a form or by pasting JSON.' },
      'kb.cp.mcp.error': { fr: 'La liste des serveurs n’a pas pu être lue : {why}', en: 'The server list could not be read: {why}' },
      'kb.cp.src.skill': { fr: 'créé par la skill', en: 'made by the skill' },
      'kb.cp.src.ro': { fr: 'lecture seule', en: 'read only' },
      'kb.cp.st.nolive': { fr: 'Configuré', en: 'Configured' },
      'kb.cp.st.loading': { fr: 'Chargement…', en: 'Loading…' },
      'kb.cp.st.active': { fr: 'Actif · {n} outils', en: 'Active · {n} tools' },
      'kb.cp.st.noTools': { fr: 'Chargé · aucun outil', en: 'Loaded · no tools' },
      'kb.cp.st.failed': { fr: 'Échec du chargement', en: 'Failed to load' },
      'kb.cp.st.off': { fr: 'Désactivé', en: 'Disabled' },
      'kb.cp.st.notloaded': { fr: 'Pas encore chargé', en: 'Not loaded yet' },
      'kb.cp.st.stale': { fr: 'Non chargé : redémarrez DSH', en: 'Not loaded: restart DSH' },
      'kb.cp.st.hint.noTools': { fr: 'Le serveur est configuré mais n’a enregistré aucun outil : il n’a sans doute pas pu démarrer. Testez-le pour voir pourquoi.', en: 'The server is configured but registered no tools: it probably could not start. Test it to see why.' },
      'kb.cp.st.hint.stale': { fr: 'DSH n’a pas rechargé sa configuration. Redémarrez DSH pour que ce serveur soit chargé.', en: 'DSH did not reload its configuration. Restart DSH for this server to load.' },
      'kb.cp.act.test': { fr: 'Tester', en: 'Test' },
      'kb.cp.act.edit': { fr: 'Modifier', en: 'Edit' },
      'kb.cp.act.del': { fr: 'Supprimer', en: 'Delete' },
      'kb.cp.act.toggle': { fr: 'Activer ou désactiver {name}', en: 'Enable or disable {name}' },
      'kb.cp.act.testing': { fr: 'Test en cours : initialisation, puis liste des outils…', en: 'Testing: initialize, then the tool list…' },
      'kb.cp.test.ok': { fr: 'Connecté en {s} s. {n} outils :', en: 'Connected in {s} s. {n} tools:' },
      'kb.cp.test.none': { fr: 'Connecté en {s} s, mais le serveur n’expose aucun outil.', en: 'Connected in {s} s, but the server exposes no tools.' },
      'kb.cp.test.fail': { fr: 'Échec du test.', en: 'Test failed.' },
      'kb.cp.test.missing': { fr: 'Secret sans valeur : {names}.', en: 'Secret with no value: {names}.' },
      'kb.cp.test.stderr': { fr: 'Dernier message du programme :', en: 'The program’s last words:' },
      'kb.cp.test.noise': { fr: '{n} ligne(s) écrites sur stdout ne sont pas du protocole : le serveur marche, mais écrit ses logs au mauvais endroit.', en: '{n} line(s) written on stdout are not protocol: the server works, but writes its logs in the wrong place.' },
      'kb.cp.terr.401': { fr: 'Le serveur refuse l’accès (401). Vérifiez l’en-tête et le secret.', en: 'The server refuses access (401). Check the header and the secret.' },
      'kb.cp.terr.403': { fr: 'Le serveur interdit l’accès (403).', en: 'The server forbids access (403).' },
      'kb.cp.terr.404': { fr: 'Adresse introuvable (404). Vérifiez l’URL.', en: 'Address not found (404). Check the URL.' },
      'kb.cp.terr.429': { fr: 'Le serveur limite le débit (429).', en: 'The server is rate limiting (429).' },
      'kb.cp.terr.oauth': { fr: 'Ce serveur demande une autorisation OAuth, que DSH ne gère pas : seul un en-tête fixe est possible.', en: 'This server asks for OAuth authorization, which DSH does not handle: only a fixed header is possible.' },
      'kb.cp.terr.timeout': { fr: 'Pas de réponse à temps.', en: 'No answer in time.' },
      'kb.cp.terr.offline': { fr: 'Serveur injoignable.', en: 'Server unreachable.' },
      'kb.cp.terr.bad-response': { fr: 'La réponse n’est pas du MCP (une page web ? une mauvaise adresse ?).', en: 'The answer is not MCP (a web page? a wrong address?).' },
      'kb.cp.terr.rpc-error': { fr: 'Le serveur a répondu par une erreur MCP.', en: 'The server answered with an MCP error.' },
      'kb.cp.terr.spawn': { fr: 'La commande ne peut pas démarrer ({m}).', en: 'The command cannot start ({m}).' },
      'kb.cp.terr.exited': { fr: 'Le programme s’est arrêté avant de répondre ({m}).', en: 'The program stopped before answering ({m}).' },
      'kb.cp.terr.other': { fr: 'Le serveur a répondu par une erreur ({code}).', en: 'The server answered with an error ({code}).' },
      'kb.cp.spawn.ENOENT': { fr: 'introuvable', en: 'not found' },
      'kb.cp.spawn.EACCES': { fr: 'non exécutable', en: 'not executable' },
      'kb.cp.del.confirm': { fr: 'Supprimer {name} du profil ? Une sauvegarde du fichier est gardée. Les secrets que le formulaire a écrits pour lui sont retirés de ~/.dsh/.env s’ils ne servent à rien d’autre.', en: 'Delete {name} from the profile? A backup of the file is kept. The secrets the form wrote for it are removed from ~/.dsh/.env unless something else uses them.' },
      'kb.cp.del.go': { fr: 'Supprimer', en: 'Delete' },
      'kb.cp.del.cancel': { fr: 'Annuler', en: 'Cancel' },
      'kb.cp.del.done': { fr: 'Serveur supprimé. DSH le décharge dans quelques secondes.', en: 'Server deleted. DSH unloads it in a few seconds.' },
      'kb.cp.err.del': { fr: 'Le serveur n’a pas pu être supprimé', en: 'The server could not be deleted' },
      'kb.cp.err.toggle': { fr: 'Le serveur n’a pas pu être modifié', en: 'The server could not be changed' },
      // ── the form ──
      'kb.cp.form.save': { fr: 'Enregistrer', en: 'Save' },
      'kb.cp.form.cancel': { fr: 'Annuler', en: 'Cancel' },
      'kb.cp.form.rename': { fr: 'Renommer…', en: 'Rename…' },
      'kb.cp.form.renamehint': { fr: 'Renommer crée un nouveau serveur, retire l’ancien et garde ses secrets.', en: 'Renaming creates a new server, removes the old one and keeps its secrets.' },
      'kb.cp.form.skillnote': { fr: 'Créé par la skill, pas par ce formulaire. En l’enregistrant, vous le faites passer au format standard : ses commentaires sont perdus, l’ancien fichier est sauvegardé.', en: 'Made by the skill, not by this form. Saving moves it to the standard format: its comments are lost, the old file is backed up.' },
      'kb.cp.form.ro': { fr: 'Ce serveur ne peut pas être modifié ici ({reason}). Modifiez cordis.patch.yml à la main, ou demandez-le à l’agent.', en: 'This server cannot be edited here ({reason}). Edit cordis.patch.yml by hand, or ask the agent.' },
      'kb.cp.form.test': { fr: 'Tester sans enregistrer', en: 'Test without saving' },
      'kb.cp.form.secretset': { fr: 'défini', en: 'set' },
      'kb.cp.form.secretunset': { fr: 'sans valeur', en: 'no value' },
      'kb.cp.form.secretreplace': { fr: 'Remplacer', en: 'Replace' },
      'kb.cp.form.secretnew': { fr: 'nouvelle valeur', en: 'new value' },
      'kb.cp.form.secretnone': { fr: 'Aucun secret. Écrivez $NOM dans un en-tête ou une variable pour y faire référence.', en: 'No secret. Write $NAME in a header or a variable to refer to one.' },
      'kb.cp.form.advanced': { fr: 'Avancé', en: 'Advanced' },
      'kb.cp.form.timeout': { fr: 'Délai d’un appel d’outil (secondes)', en: 'Tool call timeout (seconds)' },
      'kb.cp.form.noname': { fr: 'Donnez un nom au serveur.', en: 'Give the server a name.' },
      'kb.cp.cmd.use': { fr: 'Utiliser {path}', en: 'Use {path}' },
      'kb.cp.cmd.allow': { fr: 'Autoriser {dir} et utiliser {path}', en: 'Allow {dir} and use {path}' },
      'kb.cp.cmd.explain': { fr: 'Ce dossier n’est pas dans la liste de confiance. DSH lancera ce programme à chaque démarrage : ne confirmez que si vous le reconnaissez.', en: 'This folder is not on the trusted list. DSH will run this program every time it starts: confirm only if you recognise it.' },
      'kb.cp.cmd.none': { fr: 'Aucun programme de ce nom n’a été trouvé sur cette machine.', en: 'No program of that name was found on this machine.' },
      // ── pasting JSON ──
      'kb.cp.imp.title': { fr: 'Coller du JSON', en: 'Paste JSON' },
      'kb.cp.imp.sub': { fr: 'format « mcpServers » (Claude Desktop, Cursor, docs des serveurs)', en: '"mcpServers" format (Claude Desktop, Cursor, server docs)' },
      'kb.cp.imp.label': { fr: 'Le bloc de configuration', en: 'The configuration block' },
      'kb.cp.imp.invalid': { fr: 'Ce n’est pas du JSON valide : {why}', en: 'This is not valid JSON: {why}' },
      'kb.cp.imp.nomap': { fr: 'Aucun bloc « mcpServers » trouvé.', en: 'No "mcpServers" block found.' },
      'kb.cp.imp.go': { fr: 'Importer la sélection', en: 'Import the selection' },
      'kb.cp.imp.hint': { fr: 'Rien n’est écrit avant « Importer ». Les valeurs secrètes ne repassent jamais à l’écran.', en: 'Nothing is written before "Import". Secret values never come back to the screen.' },
      'kb.cp.imp.exists': { fr: 'Un serveur de ce nom existe déjà : l’importer le remplace.', en: 'A server of that name exists: importing replaces it.' },
      'kb.cp.imp.sse': { fr: 'Transport SSE : DSH ne gère que HTTP streamable ou une commande locale.', en: 'SSE transport: DSH only handles streamable HTTP or a local command.' },
      'kb.cp.imp.badname': { fr: 'Nom corrigé en « {name} » (minuscules, chiffres et tirets).', en: 'Name changed to "{name}" (lowercase letters, digits and dashes).' },
      'kb.cp.imp.notfound': { fr: '« {cmd} » est introuvable sur cette machine.', en: '"{cmd}" was not found on this machine.' },
      'kb.cp.imp.relative': { fr: '« {cmd} » n’est pas un chemin absolu : {path} est présent sur cette machine.', en: '"{cmd}" is not an absolute path: {path} exists on this machine.' },
      'kb.cp.imp.allow': { fr: 'Autoriser {dir}', en: 'Allow {dir}' },
      'kb.cp.imp.secret': { fr: '{what} : la valeur sera mise dans ~/.dsh/.env et remplacée par ${name}.', en: '{what}: the value goes into ~/.dsh/.env and is replaced by ${name}.' },
      'kb.cp.imp.done': { fr: '{n} serveur(s) importé(s). DSH les charge dans quelques secondes.', en: '{n} server(s) imported. DSH loads them in a few seconds.' },
      'kb.cp.imp.failed': { fr: 'Échec pour {name} : {why}', en: 'Failed for {name}: {why}' },
      'kb.cp.imp.none': { fr: 'Rien à importer.', en: 'Nothing to import.' },
      'kb.cp.kc.mode.label': { fr: 'Mode', en: 'Mode' },
      'kb.cp.kc.mode.personal': { fr: 'Ma clé Composio', en: 'My Composio key' },
      'kb.cp.kc.mode.kybernos': { fr: 'Connexions Kybernos', en: 'Kybernos connections' },
      'kb.cp.kc.mode.hint.personal': { fr: 'Vos comptes Composio, avec votre propre clé, sur cette machine.', en: 'Your Composio accounts, with your own key, on this machine.' },
      'kb.cp.kc.mode.hint.kybernos': { fr: 'Vos apps reliées à votre compte Kybernos : tous vos agents les utilisent, sans clé sur cette machine.', en: 'Your apps linked to your Kybernos account: all your agents use them, with no key on this machine.' },
      'kb.cp.kc.add': { fr: 'Connecter une app', en: 'Connect an app' },
      'kb.cp.kc.meter': { fr: '{count} sur {limit} connexions', en: '{count} of {limit} connections' },
      'kb.cp.kc.meter.nolimit': { fr: '{count} connexion(s)', en: '{count} connection(s)' },
      'kb.cp.kc.meter.note': { fr: 'Une demande en attente compte aussi.', en: 'A pending request counts too.' },
      'kb.cp.kc.full': { fr: 'Limite atteinte ({limit} sur {limit}) : retirez une connexion pour en ajouter. Le maximum dépend de votre offre.', en: 'Limit reached ({limit} of {limit}): remove a connection to add one. The maximum depends on your plan.' },
      'kb.cp.kc.empty': { fr: 'Aucune app connectée. Connectez Gmail, GitHub ou Slack : vos agents pourront les utiliser aussitôt.', en: 'No app connected. Connect Gmail, GitHub or Slack: your agents can use them right away.' },
      'kb.cp.kc.st.active': { fr: 'Actif', en: 'Active' },
      'kb.cp.kc.st.pending': { fr: 'En attente', en: 'Pending' },
      'kb.cp.kc.st.failed': { fr: 'Échec', en: 'Failed' },
      'kb.cp.kc.st.expired': { fr: 'Expirée', en: 'Expired' },
      'kb.cp.kc.st.disabled': { fr: 'Désactivée', en: 'Disabled' },
      'kb.cp.kc.st.unknown': { fr: 'Inconnu', en: 'Unknown' },
      'kb.cp.kc.type.api_key': { fr: 'clé API', en: 'API key' },
      'kb.cp.kc.default': { fr: 'par défaut', en: 'default' },
      'kb.cp.kc.pend': { fr: 'Terminez dans l’onglet ouvert chez {app}. Cette ligne se met à jour toute seule.', en: 'Finish in the tab opened at {app}. This row updates by itself.' },
      'kb.cp.kc.pend.sub': { fr: 'Vérifié toutes les 5 s, pendant 10 minutes au plus. Onglet fermé ? Annulez et recommencez.', en: 'Checked every 5 s, for 10 minutes at most. Tab closed? Cancel and start again.' },
      'kb.cp.kc.pend.open': { fr: 'Ouvrir la page d’autorisation', en: 'Open the authorization page' },
      'kb.cp.kc.pend.timeout': { fr: 'Toujours en attente après 10 minutes. Annulez et recommencez.', en: 'Still pending after 10 minutes. Cancel and start again.' },
      'kb.cp.kc.failed.refused': { fr: '{app} a refusé la connexion.', en: '{app} refused the connection.' },
      'kb.cp.kc.failed.upstream': { fr: '{app} n’a pas répondu.', en: '{app} did not answer.' },
      'kb.cp.kc.failed.unknown': { fr: 'La connexion a échoué.', en: 'The connection failed.' },
      'kb.cp.kc.failed.hint': { fr: 'Réessayez : la tentative est retirée et une nouvelle commence.', en: 'Try again: the attempt is removed and a new one starts.' },
      'kb.cp.kc.expired': { fr: 'L’accord n’est plus valable. Les agents ne peuvent plus utiliser ce compte tant qu’il n’est pas reconnecté.', en: 'The authorization is no longer valid. Agents cannot use this account until it is reconnected.' },
      'kb.cp.kc.disabled': { fr: 'Ce compte est désactivé chez Composio. Reconnectez-le pour le réutiliser.', en: 'This account is switched off at Composio. Reconnect it to use it again.' },
      'kb.cp.kc.act.cancel': { fr: 'Annuler', en: 'Cancel' },
      'kb.cp.kc.act.cancelreq': { fr: 'Annuler cette demande', en: 'Cancel that request' },
      'kb.cp.kc.act.retry': { fr: 'Réessayer', en: 'Try again' },
      'kb.cp.kc.act.reconnect': { fr: 'Reconnecter', en: 'Reconnect' },
      'kb.cp.kc.act.remove': { fr: 'Retirer', en: 'Remove' },
      'kb.cp.kc.del.confirm': { fr: 'Retirer {name} ? Les agents n’y auront plus accès, et le compte est aussi retiré chez Composio. Il faudra le reconnecter pour le retrouver.', en: 'Remove {name}? Agents lose access to it, and the account is removed at Composio too. You would have to connect it again.' },
      'kb.cp.kc.done.removed': { fr: 'Connexion retirée.', en: 'Connection removed.' },
      'kb.cp.kc.done.active': { fr: '{app} est connecté.', en: '{app} is connected.' },
      'kb.cp.kc.done.opened': { fr: 'Onglet ouvert chez {app}. Terminez-y votre accord.', en: 'Tab opened at {app}. Finish your authorization there.' },
      'kb.cp.kc.m.title': { fr: 'Connecter une app', en: 'Connect an app' },
      'kb.cp.kc.m.search': { fr: 'Chercher une app', en: 'Search an app' },
      'kb.cp.kc.m.more': { fr: 'Afficher la suite ({n} de plus)', en: 'Show more ({n} more)' },
      'kb.cp.kc.m.noapps': { fr: 'Aucune app ne correspond.', en: 'No matching app.' },
      'kb.cp.kc.m.alias': { fr: 'Nom de la connexion (facultatif)', en: 'Connection name (optional)' },
      'kb.cp.kc.m.alias.hint': { fr: 'Utile si vous connectez deux comptes {app}.', en: 'Useful if you connect two {app} accounts.' },
      'kb.cp.kc.m.key': { fr: 'Clé API {app}', en: '{app} API key' },
      'kb.cp.kc.m.key.hint': { fr: 'Envoyée une seule fois au serveur Kybernos, qui la transmet à Composio. Elle n’est enregistrée nulle part et n’est plus jamais affichée.', en: 'Sent once to the Kybernos server, which passes it to Composio. It is stored nowhere and never shown again.' },
      'kb.cp.kc.m.oauth': { fr: 'Vous serez envoyé chez {app} dans un nouvel onglet pour donner votre accord. Revenez ici ensuite : la liste se met à jour toute seule.', en: 'You will be sent to {app} in a new tab to give your authorization. Come back here afterwards: the list updates by itself.' },
      'kb.cp.kc.m.go': { fr: 'Continuer chez {app}', en: 'Continue at {app}' },
      'kb.cp.kc.m.go.key': { fr: 'Connecter', en: 'Connect' },
      'kb.cp.kc.m.used': { fr: '{count} sur {limit} connexions utilisées.', en: '{count} of {limit} connections used.' },
      'kb.cp.kc.check': { fr: 'Vérifiez la liste avant de réessayer.', en: 'Check the list before trying again.' },
      'kb.cp.kc.check.go': { fr: 'Vérifier la liste', en: 'Check the list' },
      'kb.cp.kc.stale': { fr: 'La liste est peut-être périmée : le serveur n’a pas pu joindre Composio à l’instant, il montre ce qu’il savait.', en: 'The list may be out of date: the server could not reach Composio just now and shows what it knew.' },
      'kb.cp.kc.refresh': { fr: 'Actualiser', en: 'Refresh' },
      'kb.cp.kc.signin.title': { fr: 'Connectez votre compte Kybernos.', en: 'Connect your Kybernos account.' },
      'kb.cp.kc.signin.body': { fr: 'Vos apps sont reliées à votre compte, pas à cette machine : une fois connectées, tous vos agents les utilisent, ici comme ailleurs.', en: 'Your apps are linked to your account, not to this machine: once connected, all your agents use them, here and elsewhere.' },
      'kb.cp.kc.signin.go': { fr: 'Connecter mon compte Kybernos', en: 'Connect my Kybernos account' },
      'kb.cp.kc.signin.wait': { fr: 'En attente de votre accord dans l’onglet ouvert…', en: 'Waiting for your approval in the opened tab…' },
      'kb.cp.kc.signin.code': { fr: 'Code : {code}', en: 'Code: {code}' },
      'kb.cp.kc.signin.open': { fr: 'Ouvrir la page', en: 'Open the page' },
      'kb.cp.kc.err.signin_failed': { fr: 'La connexion du compte n’a pas abouti : réessayez.', en: 'Connecting the account did not work: try again.' },
      'kb.cp.kc.err.reconnect_required': { fr: 'Votre session Kybernos a pris fin. Connectez votre compte à nouveau.', en: 'Your Kybernos session has ended. Connect your account again.' },
      'kb.cp.kc.err.network': { fr: 'Le serveur Kybernos est injoignable. Réessayez dans un instant.', en: 'The Kybernos server cannot be reached. Try again in a moment.' },
      'kb.cp.kc.err.connection_limit': { fr: 'Limite atteinte ({count} sur {limit}). Retirez une connexion pour en ajouter.', en: 'Limit reached ({count} of {limit}). Remove a connection to add one.' },
      'kb.cp.kc.err.pending_exists': { fr: 'Une connexion {app} attend déjà votre accord. Terminez-la, ou annulez-la pour en commencer une autre.', en: 'A {app} connection is already waiting for your authorization. Finish it, or cancel it to start another.' },
      'kb.cp.kc.err.needs_api_key': { fr: 'Cette app se connecte avec une clé API : collez-la dans le champ ci-dessous.', en: 'This app connects with an API key: paste it in the field below.' },
      'kb.cp.kc.err.upstream_unavailable': { fr: 'Le serveur n’a pas pu joindre Composio. Un instant, puis réessayez.', en: 'The server could not reach Composio. Wait a moment, then try again.' },
      'kb.cp.kc.err.upstream_check': { fr: 'Le serveur n’a pas répondu à temps : la connexion a peut-être été créée.', en: 'The server did not answer in time: the connection may have been created.' },
      'kb.cp.kc.err.connections_disabled': { fr: 'Ce serveur n’offre pas les connexions pour le moment.', en: 'This server does not offer connections right now.' },
      'kb.cp.kc.err.not_found': { fr: 'Cette connexion n’existe plus.', en: 'This connection no longer exists.' },
      'kb.cp.kc.err.too_many_requests': { fr: 'Trop de demandes d’un coup. Patientez un instant.', en: 'Too many requests at once. Wait a moment.' },
      'kb.cp.kc.err.bad_request': { fr: 'Demande refusée : vérifiez l’app et la clé.', en: 'Request refused: check the app and the key.' },
      'kb.cp.kc.err.forbidden': { fr: 'Ce compte ne peut pas utiliser les connexions.', en: 'This account cannot use connections.' },
      'kb.cp.kc.err.other': { fr: 'Réponse inattendue du serveur ({code}).', en: 'Unexpected answer from the server ({code}).' },
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
      if (c === '502' || c === '503' || c === '504') return kbt('kb.cp.err.gateway').replace('{code}', c)
      return kbt('kb.cp.err.other').replace('{code}', c.length > 0 ? c : '?')
    }
    /**
     * What the key panel shows, from GET /key and GET /connections?toolkits=gmail (the second says whether
     * Composio accepts the key; null when it did not answer). Returns null when the host plugin does not
     * answer at all. `agents` is 'same' when the running agents hold the key, else 'later' (they read it when
     * DSH starts).
     */
    const kbCpKeyState = (key, conns) => {
      if (key === null || key === undefined || typeof key !== 'object' || key.ok !== true) return null
      if (key.configured !== true) return { present: false, env: false, accepted: null, agents: null }
      const err = conns !== null && conns !== undefined && typeof conns === 'object' && conns.ok === true ? (conns.error === null || conns.error === undefined ? null : String(conns.error)) : 'unknown'
      let accepted = 'yes'
      if (err === '401' || err === '403') accepted = 'no'
      else if (err !== null) accepted = 'unchecked'
      return { present: true, env: key.source === 'env', accepted: accepted, agents: key.agents === 'same' ? 'same' : 'later' }
    }

    // ── MCP servers: pure helpers (the page and the tests share them) ──────────
    /** The contract version of the host half this page speaks (index.js API_VERSION). A host that says another one, or none, is older than this page. */
    const KB_CP_API = 2
    const kbCpHostIsOld = (json) => json === null || json === undefined || typeof json !== 'object' || json.api !== KB_CP_API
    /** What a server runs or talks to, as one line. */
    const kbCpTargetOf = (c) => (c.transport === 'streamable-http' ? String(c.url || '') : [String(c.command || '')].concat(Array.isArray(c.args) === true ? c.args : []).join(' '))

    /** What a failed connector test says, as a sentence the person can act on. `r` is the host's result ({ code, message, hint }). */
    const kbCpTestErr = (r) => {
      const code = String(r !== null && r !== undefined && r.code !== undefined && r.code !== null ? r.code : '')
      if (r !== null && r !== undefined && r.hint === 'oauth') return kbt('kb.cp.terr.oauth')
      const known = ['401', '403', '404', '429', 'timeout', 'offline', 'bad-response', 'rpc-error', 'spawn', 'exited']
      if (known.indexOf(code) < 0) return kbt('kb.cp.terr.other').replace('{code}', code.length > 0 ? code : '?')
      let m = String(r.message || '')
      if (code === 'spawn') { const row = STR['kb.cp.spawn.' + m]; if (row !== undefined) m = kbt('kb.cp.spawn.' + m) }
      const text = kbt('kb.cp.terr.' + code).replace('{m}', m)
      return code === 'rpc-error' && m.length > 0 ? text + ' ' + m : text
    }

    /**
     * The chip of a server's row from what DSH says of it (the host's `live`): { kind, key, n, hint }.
     * `recent` is true for a few seconds after the server was saved, while DSH is still reloading its
     * configuration; a server that is still not loaded after that gets the "restart DSH" hint.
     */
    const kbCpStatusOf = (c, recent) => {
      if (c.disabled === true || (c.live !== null && c.live !== undefined && c.live.loaded === true && c.live.enabled === false)) return { kind: 'plain', key: 'kb.cp.st.off' }
      const live = c.live
      if (live === null || live === undefined) return { kind: 'plain', key: 'kb.cp.st.nolive' }
      if (live.loaded !== true) return recent === true ? { kind: 'warn', key: 'kb.cp.st.loading' } : { kind: 'warn', key: 'kb.cp.st.stale', hint: 'kb.cp.st.hint.stale' }
      if (live.phase === 'failed') return { kind: 'bad', key: 'kb.cp.st.failed' }
      if (live.phase === 'loading' || live.phase === 'pending') return { kind: 'warn', key: 'kb.cp.st.loading' }
      if (live.phase === 'active') return live.tools > 0 ? { kind: 'ok', key: 'kb.cp.st.active', n: live.tools } : { kind: 'warn', key: 'kb.cp.st.noTools', hint: 'kb.cp.st.hint.noTools' }
      return { kind: 'plain', key: 'kb.cp.st.nolive' }
    }

    // ── pasting the JSON a server's documentation gives ───────────────────────
    const SERVER_NAME_RE = /^[a-z][a-z0-9-]{1,30}$/
    const SECRET_NAME_RE = /^[A-Z_][A-Z0-9_]{0,63}$/
    const SECRETISH = /KEY|TOKEN|SECRET|PASSWORD|AUTH/i
    /** A name the host accepts, made from any text: lower case, dashes for the rest, a letter first, 31 characters at most. */
    const kbCpSafeName = (raw) => {
      let n = String(raw === null || raw === undefined ? '' : raw).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
      if (/^[a-z]/.test(n) === false) n = 'srv-' + n
      n = n.slice(0, 31).replace(/-+$/, '')
      return n.length >= 2 ? n : 'serveur'
    }
    /**
     * The servers of a pasted "mcpServers" block, as { source, name, type, url, command, args, cwd, headers, env, sse }.
     * Returns { error: 'json', why } or { error: 'nomap' } when there is nothing to read. Pure: nothing is resolved or written.
     */
    const kbCpImportParse = (text) => {
      let j = null
      try { j = JSON.parse(String(text)) } catch (e) { return { error: 'json', why: String((e && e.message) || e).slice(0, 90) } }
      const map = j !== null && typeof j === 'object' && Array.isArray(j) === false ? (j.mcpServers || j.servers || (j.command !== undefined || j.url !== undefined ? null : j)) : null
      if (map === null || typeof map !== 'object' || Array.isArray(map)) return { error: 'nomap' }
      const rows = (o) => (o !== null && typeof o === 'object' && Array.isArray(o) === false ? Object.keys(o).map((k) => ({ name: k, value: String(o[k]) })) : [])
      const servers = []
      for (const source of Object.keys(map)) {
        const sv = map[source]
        if (sv === null || typeof sv !== 'object') continue
        const type = typeof sv.url === 'string' ? 'streamable-http' : (typeof sv.command === 'string' ? 'stdio' : null)
        if (type === null) continue
        servers.push({
          source: source, name: kbCpSafeName(source), type: type,
          url: typeof sv.url === 'string' ? sv.url : '', command: typeof sv.command === 'string' ? sv.command : '',
          args: Array.isArray(sv.args) ? sv.args.map((a) => String(a)) : [], cwd: typeof sv.cwd === 'string' ? sv.cwd : '',
          headers: rows(sv.headers), env: rows(sv.env),
          sse: String(sv.type || sv.transport || '').toLowerCase() === 'sse' || (type === 'streamable-http' && /\/sse\/?$/i.test(sv.url)),
        })
      }
      return servers.length === 0 ? { error: 'nomap' } : { servers: servers }
    }
    /**
     * The body to send the host for one parsed server: every secret-looking value (an API key in a header, a
     * token in an env variable) becomes a `$NAME` reference and a secret to write to the .env, so no secret ends
     * up in the config. `command` is the one to use (the host's choice when the pasted one was a bare name).
     * Returns { body, notes } where notes lists what was moved ({ what, name }) for the page to say.
     */
    const kbCpImportBody = (sv, command) => {
      const secrets = []
      const notes = []
      const used = {}
      const move = (what, name, raw, prefix) => {
        let n = String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
        if (SECRET_NAME_RE.test(n) === false) return raw
        while (used[n] === true && secrets.some((x) => x.name === n && x.value !== raw)) n += '_2'
        used[n] = true
        if (secrets.some((x) => x.name === n) === false) secrets.push({ name: n, value: raw })
        notes.push({ what: what, name: n })
        return prefix + '$' + n
      }
      const refOnly = (v) => /^(Bearer\s+|Basic\s+)?\$[A-Z_][A-Z0-9_]*$/.test(v.trim())
      const headers = sv.headers.map((h) => {
        if (refOnly(h.value) || SECRETISH.test(h.name) === false) return { name: h.name, value: h.value }
        const m = /^(Bearer\s+|Basic\s+|Token\s+)?(.*)$/i.exec(h.value)
        const prefix = m[1] || ''
        const secretName = /^authorization$/i.test(h.name) ? sv.name + '_API_KEY' : h.name
        return { name: h.name, value: move(h.name, secretName, m[2], prefix) }
      })
      const env = sv.env.map((e) => {
        if (refOnly(e.value) || SECRETISH.test(e.name) === false || SECRET_NAME_RE.test(e.name) === false) return { name: e.name, value: e.value }
        return { name: e.name, value: move(e.name, e.name, e.value, '') }
      })
      const body = { nom: sv.name, transport: sv.type, secrets: secrets }
      if (sv.type === 'streamable-http') Object.assign(body, { url: sv.url, headers: headers })
      else Object.assign(body, { command: command === undefined ? sv.command : command, args: sv.args, cwd: sv.cwd, env: env })
      return { body: body, notes: notes }
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
    // ── Kybernos connections: the second mode of "Yours" (ADR 0008 of the Kybernos server) ──────────────────────
    // The person's apps, linked once to their Kybernos account through the server's own Composio project: every agent
    // uses them, with no key on this machine. The cloud half of this machine (kybernos-cloud) holds the account's token
    // and makes every call, the page only asks it (kbCpCloud) and shows the answer. A server that does not offer the
    // feature, or a cloud half that is older than this page, answers nothing usable: the mode stays hidden.
    const CLOUD = '/kybernos-cloud'
    const KB_CP_MODE = 'kbcp.mode'
    /** How often a pending connection is asked about, and how long: past this the row says so and offers to start again. */
    const KC_POLL_MS = 5000
    const KC_POLL_MAX_MS = 10 * 60 * 1000
    /** Apps shown in the add window before « show more ». */
    const KC_PAGE = 48
    /** One call to the cloud half: { status, json } (json is null when the body is not JSON). Never throws. */
    const kbCpCloud = async (path, method, body) => {
      try {
        const init = { method: method || 'GET', credentials: 'same-origin' }
        if (body !== undefined) { init.headers = { 'content-type': 'application/json' }; init.body = JSON.stringify(body) }
        const res = await fetch(CLOUD + path, init)
        let json = null
        try { json = await res.json() } catch (e) { json = null }
        return { status: res.status, json: json }
      } catch (e) { return { status: 0, json: null } }
    }
    const kbCpModeGet = () => { try { return localStorage.getItem(KB_CP_MODE) === 'kybernos' ? 'kybernos' : 'personal' } catch (e) { return 'personal' } }
    const kbCpModeSet = (m) => { try { localStorage.setItem(KB_CP_MODE, m === 'kybernos' ? 'kybernos' : 'personal') } catch (e) { /* a convenience only */ } }
    /**
     * What GET /kybernos-cloud/connections says, as the page uses it. null when the cloud half does not answer in that shape
     * (an older host, or no cloud plugin): the mode is hidden. `connected` false means « sign in first ».
     */
    const kbCpCloudView = (r) => {
      const j = r !== null && r !== undefined ? r.json : null
      if (r === null || r === undefined || r.status !== 200 || j === null || typeof j !== 'object' || typeof j.ok !== 'boolean' || typeof j.offered !== 'boolean') return null
      if (j.offered === false) return { offered: false }
      const view = { offered: true, connected: j.connected !== false, connections: [], limit: null, count: 0, stale: false, error: null, details: {} }
      if (j.ok === true) {
        view.connections = Array.isArray(j.connections) ? j.connections.filter((c) => c !== null && typeof c === 'object' && typeof c.id === 'string') : []
        view.limit = Number.isFinite(j.limit) ? j.limit : null
        view.count = Number.isFinite(j.count) ? j.count : view.connections.length
        view.stale = j.stale === true
        return view
      }
      if (j.connected === false) return view
      view.error = typeof j.error === 'string' && j.error.length > 0 ? j.error : 'other'
      view.details = { limit: j.limit, count: j.count, existing: j.existing, checkFirst: j.checkFirst === true }
      return view
    }
    /** The view to keep after a new answer: a failed call never empties a list we already had, nor hides a mode we already showed. */
    const kbCpCloudMerge = (prev, next) => {
      const had = prev !== null && prev !== undefined && prev.offered === true
      if (next === null) return had ? Object.assign({}, prev, { error: 'network', details: {} }) : { offered: false }
      if (next.offered !== true || next.error === null || had === false || next.connected === false) return next
      return Object.assign({}, next, { connections: prev.connections, limit: prev.limit, count: prev.count, stale: true })
    }
    /** The chip of a connection: its colour family and its words. */
    const kbCpConnState = (status) => {
      if (status === 'active') return { kind: 'ok', key: 'kb.cp.kc.st.active' }
      if (status === 'pending') return { kind: 'warn', key: 'kb.cp.kc.st.pending' }
      if (status === 'failed') return { kind: 'bad', key: 'kb.cp.kc.st.failed' }
      if (status === 'expired') return { kind: 'warn', key: 'kb.cp.kc.st.expired' }
      if (status === 'disabled') return { kind: 'plain', key: 'kb.cp.kc.st.disabled' }
      return { kind: 'plain', key: 'kb.cp.kc.st.unknown' }
    }
    /** What the person can do with a connection, by status. `redo` deletes it and links again (a pending one is only cancelled). */
    const kbCpConnActions = (status) => {
      if (status === 'pending') return ['cancel']
      if (status === 'active') return ['remove']
      if (status === 'failed') return ['retry', 'remove']
      return ['reconnect', 'remove']
    }
    /** A word from the cloud half as a sentence. Never the server's own text: the cloud half only sends words. */
    const kbCpCloudErr = (word, details) => {
      const w = String(word === null || word === undefined ? '' : word)
      const d = details !== null && details !== undefined && typeof details === 'object' ? details : {}
      // An add that may have gone through is not « try again »: the sentence says to look at the list first.
      const key = w === 'upstream_unavailable' && d.checkFirst === true ? 'kb.cp.kc.err.upstream_check' : 'kb.cp.kc.err.' + w
      const known = STR[key] !== undefined
      let s = known ? kbt(key) : kbt('kb.cp.kc.err.other').replace('{code}', w.length > 0 ? w : '?')
      const existing = d.existing !== null && d.existing !== undefined && typeof d.existing === 'object' ? d.existing : {}
      s = s.replace(/\{limit\}/g, Number.isFinite(d.limit) ? String(d.limit) : '?').replace(/\{count\}/g, Number.isFinite(d.count) ? String(d.count) : '?').replace(/\{app\}/g, typeof existing.toolkit === 'string' ? nameOf(existing.toolkit) : '')
      return s
    }
    /** The line under a failed connection, from the stable code the server gave. */
    const kbCpFailedText = (failure, app) => kbt('kb.cp.kc.failed.' + (failure === 'refused' || failure === 'upstream' ? failure : 'unknown')).replace('{app}', app)
    /** The apps of the server's catalogue that match a search; at most `max`, the exact starts first. */
    const kbCpAppsMatch = (apps, query, max) => {
      const needle = kbCpSquash(query)
      const list = Array.isArray(apps) ? apps : []
      if (needle.length === 0) return list.slice(0, max)
      const hit = (a) => kbCpSquash(String(a.name) + ' ' + String(a.slug) + ' ' + (Array.isArray(a.categories) ? a.categories.join(' ') : '')).indexOf(needle) >= 0
      const starts = (a) => kbCpSquash(String(a.name)).indexOf(needle) === 0
      const found = list.filter(hit)
      return found.filter(starts).concat(found.filter((a) => !starts(a))).slice(0, max)
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
/* ── MCP servers tab: list rows whose actions appear on hover, add menu, JSON import ── */
.kbcp-addwrap{position:relative;display:inline-flex;flex:none}
.kbcp-menu{position:absolute;right:0;top:calc(100% + 6px);min-width:260px;background:var(--dsw-alias-bg-layer-2,#232324);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:12px;padding:6px;z-index:30;box-shadow:0 12px 32px rgba(0,0,0,.35)}
.kbcp-menu button{display:flex;flex-direction:column;align-items:flex-start;width:100%;gap:1px;padding:8px 10px;border:0;background:transparent;color:inherit;border-radius:8px;text-align:left;cursor:pointer;font:inherit;font-size:13px}
.kbcp-menu button:hover{background:rgba(128,128,128,.16)}
.kbcp-menu small{opacity:.6;font-size:11.5px}
.kbcp-mlist{display:flex;flex-direction:column;gap:10px;max-width:1180px}
.kbcp-mrow{border:1px solid rgba(128,128,128,.25);border-radius:12px}
.kbcp-mrow:hover{border-color:rgba(128,128,128,.45)}
.kbcp-mmain{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:12px 14px}
.kbcp-mid{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 280px}
.kbcp-mname{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-weight:650;font-size:14px}
.kbcp-mtarget{font-family:ui-monospace,Menlo,monospace;font-size:11px;opacity:.55;overflow-wrap:anywhere}
.kbcp-src{font-size:11px;opacity:.65;border:1px dashed rgba(128,128,128,.55);border-radius:99px;padding:1px 8px;font-weight:500}
.kbcp-chip{display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 11px;border-radius:99px;font-size:12px;font-weight:650;white-space:nowrap;background:rgba(128,128,128,.16)}
.kbcp-chip i{width:7px;height:7px;border-radius:50%;background:currentColor;display:inline-block}
.kbcp-chip.warn{background:rgba(245,158,11,.16);color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbcp-chip.ok{background:rgba(34,197,94,.16);color:var(--dsw-alias-state-success-primary,#22c55e)}
.kbcp-chip.bad{background:rgba(242,90,90,.16);color:var(--dsw-alias-state-error-primary,#f25a5a)}
/* The actions are quiet until the row is hovered or has the keyboard focus; a touch screen always shows them. */
.kbcp-macts{display:flex;align-items:center;gap:6px;opacity:0;transition:opacity .12s}
.kbcp-mrow:hover .kbcp-macts,.kbcp-mrow:focus-within .kbcp-macts{opacity:1}
@media (hover:none){.kbcp-macts{opacity:1}}
@media (prefers-reduced-motion:reduce){.kbcp-macts{transition:none}}
.kbcp-switch{position:relative;width:38px;height:22px;border-radius:99px;border:1px solid rgba(128,128,128,.5);background:rgba(128,128,128,.2);padding:0;flex:none;cursor:pointer}
.kbcp-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:rgba(128,128,128,.9)}
.kbcp-switch[aria-checked="true"]{background:rgba(34,197,94,.2);border-color:var(--dsw-alias-state-success-primary,#22c55e)}
.kbcp-switch[aria-checked="true"]::after{transform:translateX(16px);background:var(--dsw-alias-state-success-primary,#22c55e)}
.kbcp-detail{border-top:1px solid rgba(128,128,128,.2);padding:10px 14px;font-size:12.5px;display:flex;flex-direction:column;gap:6px;line-height:1.5}
.kbcp-detail.ok b{color:var(--dsw-alias-state-success-primary,#22c55e)}
.kbcp-detail.bad b{color:var(--dsw-alias-state-error-primary,#f25a5a)}
.kbcp-detail.warn b{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbcp-tools{display:flex;flex-wrap:wrap;gap:5px}
.kbcp-tools code{font-family:ui-monospace,Menlo,monospace;font-size:11px;background:rgba(128,128,128,.18);border-radius:6px;padding:1px 7px}
.kbcp-confirm{border-top:1px solid var(--dsw-alias-state-error-primary,#f25a5a);padding:10px 14px;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;font-size:12.5px}
.kbcp-confirm p{margin:0;flex:1 1 260px}
.kbcp-note{font-size:12px;line-height:1.5;border-radius:10px;padding:9px 12px;border:1px solid rgba(128,128,128,.3);background:rgba(128,128,128,.08)}
.kbcp-note.warn{border-color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbcp-note.ok{border-color:var(--dsw-alias-state-success-primary,#22c55e)}
.kbcp-note.bad{border-color:var(--dsw-alias-state-error-primary,#f25a5a)}
.kbcp-secrow{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;font-size:12.5px}
.kbcp-secrow code{font-family:ui-monospace,Menlo,monospace;font-size:12px}
.kbcp-textarea{width:100%;height:170px;border-radius:9px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;padding:10px 11px;font-family:ui-monospace,Menlo,monospace;font-size:12px;line-height:1.5;resize:vertical;box-sizing:border-box}
.kbcp-found{display:flex;flex-direction:column;gap:8px}
.kbcp-fitem{border:1px solid rgba(128,128,128,.25);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.kbcp-fitem .kbcp-ftop{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.kbcp-fitem .kbcp-ftop label{display:flex;gap:8px;align-items:center;font-weight:650;font-size:13px}
.kbcp-fitem ul{margin:0;padding-left:18px;font-size:12px;display:flex;flex-direction:column;gap:3px;opacity:.85}
.kbcp-fitem .kbcp-good{color:var(--dsw-alias-state-success-primary,#22c55e)}
.kbcp-fitem .kbcp-badl{color:var(--dsw-alias-state-error-primary,#f25a5a)}
.kbcp-fitem .kbcp-warnl{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbcp-help2{font-size:11.5px;opacity:.65;line-height:1.45}
.kbcp-toast{font-size:12.5px;color:var(--dsw-alias-state-success-primary,#22c55e)}
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
/* ── Kybernos connections mode: the mode switch, the quota meter, the app picker of the add window ── */
.kbcp-modebar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:0 0 14px}
.kbcp-kc{display:flex;flex-direction:column;gap:12px;max-width:1180px}
.kbcp-kcmeter{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;font-size:13px}
.kbcp-kcbar{display:inline-flex;gap:4px}
.kbcp-kcbar i{width:26px;height:6px;border-radius:99px;background:rgba(128,128,128,.28)}
.kbcp-kcbar i.on{background:#635bff}
.kbcp-kcbar i.pend{background:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbcp-kcpick{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px;max-height:250px;overflow:auto;padding:2px}
.kbcp-kcapp{display:flex;align-items:center;gap:9px;text-align:left;padding:8px 10px;border-radius:10px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;cursor:pointer;font:inherit;min-width:0}
.kbcp-kcapp:hover{background:rgba(128,128,128,.12)}
.kbcp-kcapp.on{border-color:#635bff;background:rgba(99,91,255,.16)}
.kbcp-kcapp span{display:flex;flex-direction:column;min-width:0}
.kbcp-kcapp b{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbcp-kcapp small{font-size:11px;opacity:.6}
.kbcp-kcrow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:6px}
`

    // ── Key config (bundle page, Plugins) ────────────────────────────────────
    // The key lives in the DSH .env, on this machine: the host checks it with Composio and writes it where
    // the agents read it. This panel only asks the host and shows what it says. The previous version kept a
    // copy in this browser; one found there is offered for saving and then forgotten.
    const KB_CP_OLD_KEY = 'composio.apiKey'
    const ComposioKeyConfig = () => {
      const [v, setV] = React.useState('')
      const [state, setState] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const [old, setOld] = React.useState('')
      const [tick, setTick] = React.useState(0)
      React.useEffect(() => {
        let dead = false
        ;(async () => {
          const k = await kbCpHost('/key')
          let c = null
          if (k.status === 200 && k.json !== null && k.json.configured === true) c = (await kbCpHost('/connections?toolkits=gmail')).json
          const st = k.status === 200 && kbCpHostIsOld(k.json) === false ? kbCpKeyState(k.json, c) : null
          if (dead === true) return
          setState(st)
          let left = ''
          try { left = localStorage.getItem(KB_CP_OLD_KEY) || '' } catch (e) { left = '' }
          if (left.length === 0) { setOld(''); return }
          // The host has a key: the copy in the browser is not needed. It has none: offer to move this one.
          if (st !== null && st.present === true) { try { localStorage.removeItem(KB_CP_OLD_KEY) } catch (e) { } setOld('') } else if (st !== null && /^ck_/.test(left)) setOld(left)
        })()
        return () => { dead = true }
      }, [tick])
      const save = async (value) => {
        setBusy(true)
        setMsg(null)
        const r = await kbCpHost('/key', 'POST', { key: String(value).trim() })
        setBusy(false)
        if (r.status === 200 && r.json !== null && r.json.ok === true) {
          setV('')
          setOld('')
          try { localStorage.removeItem(KB_CP_OLD_KEY) } catch (e) { }
          setMsg({ kind: r.json.verified === true ? 'ok' : 'warn', text: kbt(r.json.verified !== true ? 'composio.savedunchecked' : (r.json.needRestart === true ? 'composio.saved' : 'composio.savedlive')) })
          try { window.dispatchEvent(new Event('kbcp-key')) } catch (e) { }
          setTick((n) => n + 1)
        } else {
          const code = r.json !== null && r.json.code !== undefined ? String(r.json.code) : ''
          setMsg({ kind: 'bad', text: kbt(code === 'invalid-key' ? 'composio.err.invalid' : (code === '401' || code === '403' ? 'composio.err.rejected' : (code === 'inherited' ? 'composio.err.inherited' : 'composio.err.write'))) })
        }
      }
      const clear = async () => {
        setBusy(true)
        setMsg(null)
        const r = await kbCpHost('/key', 'DELETE')
        setBusy(false)
        if (r.status !== 200) setMsg({ kind: 'bad', text: kbt(r.json !== null && r.json.code === 'inherited' ? 'composio.err.inherited' : 'composio.err.write') })
        try { window.dispatchEvent(new Event('kbcp-key')) } catch (e) { }
        setTick((n) => n + 1)
      }
      const DASH = 'https://dashboard.composio.dev/'
      const line = (kind, key) => h('div', { className: 'kbcp-row', key: key },
        h('span', { className: 'kbcp-state' }, h('span', { className: 'kbcp-dot' + (kind === '' ? '' : ' ' + kind) }), kbt(key)))
      const lines = []
      if (state === null) lines.push(line('warn', 'composio.hostunknown'))
      else if (state !== undefined && state.present === false) lines.push(line('', 'composio.keyunset'))
      else if (state !== undefined) {
        lines.push(line('on', state.env === true ? 'composio.keyenv' : 'composio.keyset'))
        lines.push(line(state.accepted === 'yes' ? 'on' : (state.accepted === 'no' ? 'bad' : 'warn'), state.accepted === 'yes' ? 'composio.accepted' : (state.accepted === 'no' ? 'composio.rejected' : 'composio.unchecked')))
        lines.push(line(state.agents === 'same' ? 'on' : 'warn', state.agents === 'same' ? 'composio.agentsSame' : 'composio.agentsLater'))
      }
      const locked = state !== undefined && state !== null && state.env === true
      return h('div', { className: 'kbcp-config' },
        h('h3', null, h('span', { className: 'kbcp-logo' }, 'C'), kbt('composio.keylabel')),
        h('div', { 'data-kb': 'composio-host-state' }, lines),
        h('div', { className: 'kbcp-note' }, kbt('composio.keynote')),
        old.length > 0 ? h('div', { className: 'kbcp-row' },
          h('span', { className: 'kbcp-help2', style: { flex: 1 } }, kbt('composio.migrate')),
          h('button', { type: 'button', className: 'kbcp-btn primary', disabled: busy, onClick: () => save(old) }, kbt('composio.keysave'))) : null,
        h('div', { className: 'kbcp-row' },
          h('input', { className: 'kbcp-input', type: 'password', value: v, placeholder: 'ck_…', disabled: locked || busy, onChange: (e) => setV(e.target.value), autoComplete: 'off', 'aria-label': kbt('composio.keylabel') }),
          h('button', { type: 'button', className: 'kbcp-btn primary', disabled: locked || busy || v.trim().length === 0, onClick: () => save(v) }, kbt('composio.keysave')),
          state !== undefined && state !== null && state.present === true && locked === false ? h('button', { type: 'button', className: 'kbcp-btn', disabled: busy, onClick: clear }, kbt('composio.keyclear')) : null),
        msg !== null ? h('div', { className: 'kbcp-note ' + msg.kind, role: 'status' }, msg.text) : null,
        h('details', { className: 'kbcp-help' },
          h('summary', null, kbt('composio.keyhelpq')),
          h('ol', null,
            h('li', null, h('a', { href: DASH, target: '_blank', rel: 'noopener' }, 'dashboard.composio.dev'), ' — ', kbt('composio.keyhelp1')),
            h('li', null, kbt('composio.keyhelp2')),
            h('li', null, kbt('composio.keyhelp3')))))
    }

    // ── MCP servers: the form, pasting JSON, and the list ────────────────────
    // The host writes the config and the .env itself: the person never sees the YAML. A value can
    // refer to a secret as $NAME. Every call goes through the host (kbCpHost).
    const EMPTY_FORM = () => ({ nom: '', transport: 'streamable-http', url: '', command: '', args: '', cwd: '', headers: [], env: [], secrets: [], timeoutS: '' })
    const TOKEN_IN = /\$([A-Z_][A-Z0-9_]*)/g
    const kbCpTokens = (rows) => {
      const out = []
      for (const r of rows) { const re = new RegExp(TOKEN_IN.source, 'g'); let m; while ((m = re.exec(String(r.value))) !== null) if (out.indexOf(m[1]) < 0) out.push(m[1]) }
      return out
    }
    /** The form's state for a server of the list (null = a new one). */
    const kbCpFormOf = (it) => {
      if (it === null || it === undefined) return EMPTY_FORM()
      const headers = Array.isArray(it.headers) ? it.headers.map((x) => ({ name: String(x.name || ''), value: String(x.value || '') })) : []
      const env = Array.isArray(it.env) ? it.env.map((x) => ({ name: String(x.name || ''), value: String(x.value || '') })) : []
      const names = (Array.isArray(it.secrets) ? it.secrets.filter((n) => typeof n === 'string') : []).concat(kbCpTokens(headers.concat(env)))
      const seen = {}
      const secrets = []
      for (const n of names) { if (seen[n] === true) continue; seen[n] = true; secrets.push({ name: n, known: true, set: it.secretsSet !== undefined && it.secretsSet !== null && it.secretsSet[n] === true, replace: false, value: '' }) }
      return {
        nom: String(it.nom || ''), transport: it.transport === 'stdio' ? 'stdio' : 'streamable-http',
        url: String(it.url || ''), command: String(it.command || ''),
        args: Array.isArray(it.args) ? kbCpJoinArgs(it.args) : String(it.args || ''),
        cwd: String(it.cwd || ''), headers: headers, env: env, secrets: secrets,
        timeoutS: Number.isInteger(it.toolCallTimeoutMs) ? String(it.toolCallTimeoutMs / 1000) : '',
      }
    }
    /** The body the host's save and test routes take, from the form's state. */
    const kbCpBodyOf = (f, initial) => {
      const body = { nom: f.nom.trim(), transport: f.transport, url: f.url.trim(), command: f.command.trim(), args: f.args, cwd: f.cwd.trim(), headers: f.headers, env: f.env, secrets: f.secrets.filter((s) => s.value.trim().length > 0 && s.name.trim().length > 0).map((s) => ({ name: s.name.trim(), value: s.value })) }
      if (initial !== null && initial !== undefined) {
        if (initial.disabled === true) body.disabled = true
        if (Number.isInteger(initial.toolCallTimeoutMs)) body.toolCallTimeoutMs = initial.toolCallTimeoutMs
      }
      const t = Number(f.timeoutS)
      if (f.timeoutS !== '' && isFinite(t) && t > 0) body.toolCallTimeoutMs = Math.round(t * 1000)
      return body
    }
    /** The facts of a connector test as lines: the result, a missing secret, the program's last words, stray stdout. */
    const kbCpTestView = (test) => {
      if (test === null || test === undefined) return null
      if (test.busy === true) return h('div', { className: 'kbcp-note' }, kbt('kb.cp.act.testing'))
      const r = test.result
      const missing = Array.isArray(test.missing) && test.missing.length > 0 ? h('div', { key: 'm' }, kbt('kb.cp.test.missing').replace('{names}', test.missing.join(', '))) : null
      if (r === null || r === undefined) return h('div', { className: 'kbcp-note bad' }, kbt('kb.cp.test.fail'))
      if (r.ok === true) {
        const tools = Array.isArray(r.tools) ? r.tools : []
        const secs = String(Math.max(0.1, Math.round(r.ms / 100) / 10))
        return h('div', { className: 'kbcp-note ok' },
          h('div', null, h('b', null, tools.length > 0 ? kbt('kb.cp.test.ok').replace('{s}', secs).replace('{n}', String(tools.length)) : kbt('kb.cp.test.none').replace('{s}', secs))),
          tools.length > 0 ? h('div', { className: 'kbcp-tools' }, tools.map((t) => h('code', { key: t.name, title: t.description || '' }, t.name))) : null,
          missing,
          r.noise > 0 ? h('div', { className: 'kbcp-help2' }, kbt('kb.cp.test.noise').replace('{n}', String(r.noise))) : null)
      }
      return h('div', { className: 'kbcp-note bad' },
        h('div', null, h('b', null, kbt('kb.cp.test.fail')), ' ', kbCpTestErr(r)),
        missing,
        typeof r.stderr === 'string' && r.stderr.length > 0 ? h('div', { className: 'kbcp-help2' }, kbt('kb.cp.test.stderr'), ' ', h('code', null, r.stderr)) : null)
    }

    const ConnecteurForm = (props) => {
      const initial = props.initial !== null && props.initial !== undefined ? props.initial : null
      const readOnly = initial !== null && initial.editable === false
      const [f, setF] = React.useState(() => kbCpFormOf(initial))
      const [renaming, setRenaming] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [ferr, setFerr] = React.useState(null)
      const [test, setTest] = React.useState(null)
      const [help, setHelp] = React.useState(null)
      const up = (patch) => setF((prev) => Object.assign({}, prev, patch))
      const setRow = (key, i, field, value) => setF((prev) => Object.assign({}, prev, { [key]: prev[key].map((x, j) => (j === i ? Object.assign({}, x, { [field]: value }) : x)) }))
      const addRow = (key, row) => setF((prev) => Object.assign({}, prev, { [key]: prev[key].concat([row]) }))
      const delRow = (key, i) => setF((prev) => Object.assign({}, prev, { [key]: prev[key].filter((x, j) => j !== i) }))
      const isNew = initial === null
      const isHttp = f.transport === 'streamable-http'

      const pair = (key, title, phName, phValue) => h('div', { className: 'kb7-fgroup' },
        h('div', { className: 'kb7-fgrouptitle' }, title),
        f[key].map((p, i) => h('div', { className: 'kb7-frow', key: key + i },
          h('input', { className: 'kb7-finput', style: { maxWidth: 210 }, value: p.name, placeholder: phName, onChange: (e) => setRow(key, i, 'name', e.target.value), autoComplete: 'off', spellCheck: false, 'aria-label': phName }),
          h('input', { className: 'kb7-finput', value: p.value, placeholder: phValue, onChange: (e) => setRow(key, i, 'value', e.target.value), autoComplete: 'off', spellCheck: false, 'aria-label': phValue }),
          h('button', { type: 'button', className: 'kbcp-btn', onClick: () => delRow(key, i), 'aria-label': kbt('kb.cp.dismiss') }, Icon('x', 12)))),
        h('button', { type: 'button', className: 'kbcp-btn', style: { alignSelf: 'flex-start' }, onClick: () => addRow(key, { name: '', value: '' }) }, Icon('plus', 12), ' ' + kbt('kb.cp.form.addrow')))

      // A command the host refused comes with where the program is: use it, or confirm its folder once.
      const helpFor = async (value) => {
        const r = await kbCpHost('/connecteurs/commande?command=' + encodeURIComponent(value))
        setHelp(r.json !== null && Array.isArray(r.json.help) ? r.json.help : [])
      }
      const allowDir = async (hit) => {
        const r = await kbCpHost('/connecteurs/commande', 'POST', { dir: hit.dir })
        if (r.status === 200) { up({ command: hit.path }); setHelp(null); setFerr(null); if (typeof props.onRoots === 'function') props.onRoots() } else setFerr(r.json !== null && typeof r.json.error === 'string' ? r.json.error : 'HTTP ' + r.status)
      }
      const helpView = () => (help === null ? null : h('div', { className: 'kbcp-found' },
        help.length === 0 ? h('div', { className: 'kbcp-note warn' }, kbt('kb.cp.cmd.none')) : null,
        help.some((x) => x.allowed !== true) ? h('div', { className: 'kbcp-help2' }, kbt('kb.cp.cmd.explain')) : null,
        help.map((x) => h('button', { type: 'button', key: x.path, className: 'kbcp-btn', style: { alignSelf: 'flex-start' }, onClick: () => (x.allowed === true ? (up({ command: x.path }), setHelp(null), setFerr(null)) : allowDir(x)) },
          (x.allowed === true ? kbt('kb.cp.cmd.use') : kbt('kb.cp.cmd.allow').replace('{dir}', x.dir)).replace('{path}', x.path)))))

      const failure = (r) => {
        const j = r.json
        if (j !== null && j.code === 'command-refused') { setHelp(Array.isArray(j.help) ? j.help : []); setFerr(String(j.error || '')); return }
        setFerr(j !== null && typeof j.error === 'string' ? j.error : (r.status === 0 ? kbt('kb.cp.err.offline') : 'HTTP ' + r.status))
      }
      const save = async () => {
        if (f.nom.trim().length === 0) { setFerr(kbt('kb.cp.form.noname')); return }
        setBusy(true)
        setFerr(null)
        const body = kbCpBodyOf(f, initial)
        if (initial !== null && f.nom.trim() !== initial.nom) body.renameFrom = initial.nom
        const r = await kbCpHost('/connecteurs', 'POST', body)
        setBusy(false)
        if (r.status === 200 && r.json !== null && r.json.ok === true) props.onSaved(f.nom.trim())
        else failure(r)
      }
      const runTest = async () => {
        if (f.transport === 'stdio' && f.command.trim().length === 0) { setFerr(kbt('kb.cp.cmd.none')); return }
        setTest({ busy: true })
        setFerr(null)
        const r = await kbCpHost('/connecteurs/test', 'POST', kbCpBodyOf(f, initial))
        if (r.status === 200 && r.json !== null && r.json.ok === true) setTest({ result: r.json.result, missing: r.json.missing })
        else { setTest(null); failure(r) }
      }

      const title = readOnly ? initial.nom : (isNew ? kbt('kb.cp.form.title') : kbt('kb.cp.form.edit') + ' · ' + initial.nom)
      return h('div', { className: 'kb7-overlay', onClick: props.onClose },
        h('div', { className: 'kb7-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, onClick: (e) => e.stopPropagation() },
          h('div', { className: 'kb7-mhead' },
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { className: 'kb7-mname' }, title),
              h('div', { className: 'kb7-mcat' }, 'mcp__' + (f.nom.trim().length > 0 ? f.nom.trim() : '…') + '__*')),
            h('button', { type: 'button', className: 'kbcp-btn', onClick: props.onClose, 'aria-label': kbt('kb.cp.close') }, Icon('x', 14))),
          readOnly ? h('div', { className: 'kb7-form' },
            h('div', { className: 'kbcp-note warn' }, kbt('kb.cp.form.ro').replace('{reason}', String(initial.readOnlyReason || ''))),
            h('div', { className: 'kbcp-mtarget' }, kbCpTargetOf(initial)),
            h('div', { className: 'kb7-actions' }, h('button', { type: 'button', className: 'kbcp-btn', onClick: props.onClose }, kbt('kb.cp.close'))))
          : h('div', { className: 'kb7-form' },
            !isNew && initial.source === 'skill' ? h('div', { className: 'kbcp-note warn' }, kbt('kb.cp.form.skillnote')) : null,
            h('div', null,
              h('label', { className: 'kb7-flabel', htmlFor: 'kbcp-f-name' }, kbt('kb.cp.form.name')),
              h('div', { className: 'kb7-frow' },
                h('input', { className: 'kb7-finput', id: 'kbcp-f-name', value: f.nom, placeholder: 'tavily', disabled: !isNew && !renaming, onChange: (e) => up({ nom: e.target.value }), autoComplete: 'off', spellCheck: false }),
                !isNew && !renaming ? h('button', { type: 'button', className: 'kbcp-btn', onClick: () => setRenaming(true) }, kbt('kb.cp.form.rename')) : null),
              !isNew ? h('div', { className: 'kbcp-help2' }, kbt('kb.cp.form.renamehint')) : null),
            h('div', null,
              h('label', { className: 'kb7-flabel' }, kbt('kb.cp.form.type')),
              h('div', { className: 'kb7-fseg' },
                h('button', { type: 'button', className: isHttp ? 'on' : '', 'aria-pressed': isHttp ? 'true' : 'false', onClick: () => up({ transport: 'streamable-http' }) }, kbt('kb.cp.form.http')),
                h('button', { type: 'button', className: isHttp === false ? 'on' : '', 'aria-pressed': isHttp ? 'false' : 'true', onClick: () => up({ transport: 'stdio' }) }, kbt('kb.cp.form.stdio')))),
            isHttp === true
              ? h('div', null,
                  h('label', { className: 'kb7-flabel', htmlFor: 'kbcp-f-url' }, kbt('kb.cp.form.url')),
                  h('input', { className: 'kb7-finput', id: 'kbcp-f-url', value: f.url, placeholder: 'https://mcp.tavily.com/mcp/', onChange: (e) => up({ url: e.target.value }), autoComplete: 'off', spellCheck: false }),
                  pair('headers', kbt('kb.cp.form.headers'), 'authorization', 'Bearer $TAVILY_API_KEY'))
              : h('div', null,
                  h('label', { className: 'kb7-flabel', htmlFor: 'kbcp-f-cmd' }, kbt('kb.cp.form.command')),
                  h('input', { className: 'kb7-finput', id: 'kbcp-f-cmd', value: f.command, placeholder: '/opt/homebrew/bin/node', onChange: (e) => { up({ command: e.target.value }); setHelp(null) }, onBlur: (e) => { const t = e.target.value.trim(); if (t.length > 0 && t.charAt(0) !== '/') helpFor(t) }, autoComplete: 'off', spellCheck: false }),
                  helpView(),
                  h('label', { className: 'kb7-flabel', style: { marginTop: 8 }, htmlFor: 'kbcp-f-args' }, kbt('kb.cp.form.args')),
                  h('input', { className: 'kb7-finput', id: 'kbcp-f-args', value: f.args, placeholder: '/path/to/server.mjs --port 3000', onChange: (e) => up({ args: e.target.value }), autoComplete: 'off', spellCheck: false }),
                  h('label', { className: 'kb7-flabel', style: { marginTop: 8 }, htmlFor: 'kbcp-f-cwd' }, kbt('kb.cp.form.cwd')),
                  h('input', { className: 'kb7-finput', id: 'kbcp-f-cwd', value: f.cwd, onChange: (e) => up({ cwd: e.target.value }), autoComplete: 'off', spellCheck: false }),
                  pair('env', kbt('kb.cp.form.env'), kbt('kb.cp.form.envname'), kbt('kb.cp.form.envvalue'))),
            h('div', { className: 'kb7-fgroup' },
              h('div', { className: 'kb7-fgrouptitle' }, kbt('kb.cp.form.secrets')),
              f.secrets.length === 0 ? h('div', { className: 'kbcp-help2' }, kbt('kb.cp.form.secretnone')) : null,
              f.secrets.map((sec, i) => h('div', { className: 'kbcp-secrow', key: 'sec' + i },
                sec.known === true ? h('code', null, sec.name) : h('input', { className: 'kb7-finput', style: { maxWidth: 210 }, value: sec.name, placeholder: kbt('kb.cp.form.secretname'), onChange: (e) => setRow('secrets', i, 'name', e.target.value), autoComplete: 'off', spellCheck: false, 'aria-label': kbt('kb.cp.form.secretname') }),
                sec.known === true && sec.replace !== true
                  ? [h('span', { key: 's', className: 'kbcp-help2' }, sec.set === true ? '● ' + kbt('kb.cp.form.secretset') : '○ ' + kbt('kb.cp.form.secretunset')),
                    h('button', { key: 'b', type: 'button', className: 'kbcp-btn', onClick: () => setRow('secrets', i, 'replace', true) }, kbt('kb.cp.form.secretreplace'))]
                  : h('input', { className: 'kb7-finput', style: { maxWidth: 260 }, type: 'password', value: sec.value, placeholder: sec.known === true ? kbt('kb.cp.form.secretnew') : kbt('kb.cp.form.secretvalue'), onChange: (e) => setRow('secrets', i, 'value', e.target.value), autoComplete: 'off', 'aria-label': kbt('kb.cp.form.secretvalue') }),
                sec.known === true ? null : h('button', { type: 'button', className: 'kbcp-btn', onClick: () => delRow('secrets', i), 'aria-label': kbt('kb.cp.dismiss') }, Icon('x', 12)))),
              h('button', { type: 'button', className: 'kbcp-btn', style: { alignSelf: 'flex-start' }, onClick: () => addRow('secrets', { name: '', value: '' }) }, Icon('plus', 12), ' ' + kbt('kb.cp.form.addrow'))),
            h('div', { className: 'kb7-fhint' }, kbt('kb.cp.form.tokenhint')),
            h('details', { className: 'kbcp-help' },
              h('summary', null, kbt('kb.cp.form.advanced')),
              h('div', { style: { marginTop: 8 } },
                h('label', { className: 'kb7-flabel', htmlFor: 'kbcp-f-timeout' }, kbt('kb.cp.form.timeout')),
                h('input', { className: 'kb7-finput', id: 'kbcp-f-timeout', style: { maxWidth: 120 }, type: 'number', min: 1, max: 3600, placeholder: '180', value: f.timeoutS, onChange: (e) => up({ timeoutS: e.target.value }) }))),
            kbCpTestView(test),
            ferr !== null ? h('div', { className: 'kb7-ferr', role: 'alert' }, ferr) : null,
            h('div', { className: 'kb7-actions', style: { justifyContent: 'space-between' } },
              h('button', { type: 'button', className: 'kbcp-btn', disabled: busy || (test !== null && test.busy === true), onClick: runTest }, kbt('kb.cp.form.test')),
              h('div', { className: 'kb7-frow' },
                h('button', { type: 'button', className: 'kbcp-btn', onClick: props.onClose }, kbt('kb.cp.form.cancel')),
                h('button', { type: 'button', className: 'kbcp-btn primary', disabled: busy || f.nom.trim().length === 0, onClick: save }, busy === true ? kbt('kb.cp.form.saving') : kbt('kb.cp.form.save')))))))
    }

    // Pasting the "mcpServers" block a server's documentation gives.
    const ImportModal = (props) => {
      const SAMPLE = '{\n  "mcpServers": {\n    "github": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-github"],\n      "env": { "GITHUB_TOKEN": "ghp_..." }\n    }\n  }\n}'
      const [text, setText] = React.useState('')
      const [names, setNames] = React.useState({})
      const [sel, setSel] = React.useState({})
      const [cmds, setCmds] = React.useState({})
      const [busy, setBusy] = React.useState(false)
      const [fails, setFails] = React.useState([])
      const parsed = React.useMemo(() => (text.trim().length === 0 ? null : kbCpImportParse(text)), [text])
      const roots = props.roots !== null && props.roots !== undefined ? [].concat(props.roots.base || [], props.roots.extra || []) : []
      const insideRoots = (c) => c.charAt(0) === '/' && roots.some((r) => c.indexOf(r + '/') === 0)
      // Where each command is: already allowed, a bare name the host can find, or somewhere that needs a confirmation.
      React.useEffect(() => {
        if (parsed === null || parsed.servers === undefined) return undefined
        let dead = false
        ;(async () => {
          const next = {}
          for (const sv of parsed.servers.slice(0, 30)) {
            if (sv.type !== 'stdio') continue
            if (insideRoots(sv.command)) { next[sv.source] = { state: 'ok', path: sv.command }; continue }
            if (sv.command.charAt(0) === '/') { const dir = sv.command.slice(0, sv.command.lastIndexOf('/')) || '/'; next[sv.source] = { state: 'outside', path: sv.command, dir: dir }; continue }
            const r = await kbCpHost('/connecteurs/commande?command=' + encodeURIComponent(sv.command))
            const found = r.json !== null && Array.isArray(r.json.help) ? r.json.help : []
            const good = found.find((x) => x.allowed === true)
            const other = found.find((x) => x.allowed !== true)
            next[sv.source] = good !== undefined ? { state: 'relative', path: good.path } : (other !== undefined ? { state: 'outside', path: other.path, dir: other.dir } : { state: 'notfound' })
          }
          if (dead === false) setCmds(next)
        })()
        return () => { dead = true }
      }, [text, props.roots])
      const servers = parsed !== null && parsed.servers !== undefined ? parsed.servers : []
      const nameOf2 = (sv) => (names[sv.source] !== undefined ? names[sv.source] : sv.name)
      const blockers = (sv) => {
        const out = []
        if (sv.sse === true) out.push(kbt('kb.cp.imp.sse'))
        if (SERVER_NAME_RE.test(nameOf2(sv)) === false) out.push(kbt('kb.cp.form.noname'))
        const c = cmds[sv.source]
        if (sv.type === 'stdio' && (c === undefined || c.state === 'outside' || c.state === 'notfound')) out.push(c !== undefined && c.state === 'notfound' ? kbt('kb.cp.imp.notfound').replace('{cmd}', sv.command) : kbt('kb.cp.cmd.explain'))
        return out
      }
      const allow = async (sv) => {
        const c = cmds[sv.source]
        const r = await kbCpHost('/connecteurs/commande', 'POST', { dir: c.dir })
        if (r.status === 200) { if (typeof props.onRoots === 'function') props.onRoots() } else setFails([{ name: sv.name, why: r.json !== null && typeof r.json.error === 'string' ? r.json.error : 'HTTP ' + r.status }])
      }
      const doImport = async () => {
        setBusy(true)
        const bad = []
        let done = 0
        const imported = []
        for (const sv of servers) {
          if (sel[sv.source] === false || blockers(sv).length > 0) continue
          const c = cmds[sv.source]
          const { body } = kbCpImportBody(Object.assign({}, sv, { name: nameOf2(sv) }), sv.type === 'stdio' && c !== undefined ? c.path : undefined)
          const r = await kbCpHost('/connecteurs', 'POST', body)
          if (r.status === 200 && r.json !== null && r.json.ok === true) { done += 1; imported.push(body.nom) }
          else bad.push({ name: body.nom, why: r.json !== null && typeof r.json.error === 'string' ? r.json.error : 'HTTP ' + r.status })
        }
        setBusy(false)
        setFails(bad)
        if (bad.length === 0) props.onDone(done, imported)
        else if (done > 0 && typeof props.onChanged === 'function') props.onChanged(imported)
      }
      const exists = (sv) => (props.existing || []).indexOf(nameOf2(sv)) >= 0
      return h('div', { className: 'kb7-overlay', onClick: props.onClose },
        h('div', { className: 'kb7-modal', style: { maxWidth: 620 }, role: 'dialog', 'aria-modal': 'true', 'aria-label': kbt('kb.cp.imp.title'), onClick: (e) => e.stopPropagation() },
          h('div', { className: 'kb7-mhead' },
            h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { className: 'kb7-mname' }, kbt('kb.cp.imp.title')), h('div', { className: 'kb7-mcat' }, kbt('kb.cp.imp.sub'))),
            h('button', { type: 'button', className: 'kbcp-btn', onClick: props.onClose, 'aria-label': kbt('kb.cp.close') }, Icon('x', 14))),
          h('div', { className: 'kb7-form' },
            h('div', null,
              h('label', { className: 'kb7-flabel', htmlFor: 'kbcp-imp-json' }, kbt('kb.cp.imp.label')),
              h('textarea', { className: 'kbcp-textarea', id: 'kbcp-imp-json', value: text, placeholder: SAMPLE, spellCheck: false, onChange: (e) => { setText(e.target.value); setFails([]) } })),
            parsed !== null && parsed.error === 'json' ? h('div', { className: 'kbcp-note bad' }, kbt('kb.cp.imp.invalid').replace('{why}', parsed.why)) : null,
            parsed !== null && parsed.error === 'nomap' ? h('div', { className: 'kbcp-note bad' }, kbt('kb.cp.imp.nomap')) : null,
            servers.length > 0 ? h('div', { className: 'kbcp-found' }, servers.map((sv) => {
              const bl = blockers(sv)
              const c = cmds[sv.source]
              const imported = kbCpImportBody(Object.assign({}, sv, { name: nameOf2(sv) }), sv.type === 'stdio' && c !== undefined ? c.path : undefined)
              const checked = bl.length === 0 && sel[sv.source] !== false
              return h('div', { className: 'kbcp-fitem', key: sv.source },
                h('div', { className: 'kbcp-ftop' },
                  h('label', null, h('input', { type: 'checkbox', checked: checked, disabled: bl.length > 0, onChange: (e) => setSel((prev) => Object.assign({}, prev, { [sv.source]: e.target.checked })) }), ' ',
                    h('input', { className: 'kb7-finput', style: { maxWidth: 200, height: 28 }, value: nameOf2(sv), onChange: (e) => setNames((prev) => Object.assign({}, prev, { [sv.source]: e.target.value })), autoComplete: 'off', spellCheck: false, 'aria-label': kbt('kb.cp.form.name') })),
                  h('span', { className: 'kb7-cxtype' + (sv.type === 'streamable-http' ? ' http' : '') }, sv.type === 'streamable-http' ? 'http' : 'stdio'),
                  c !== undefined && c.state === 'outside' ? h('button', { type: 'button', className: 'kbcp-btn', onClick: () => allow(sv) }, kbt('kb.cp.imp.allow').replace('{dir}', c.dir)) : null),
                h('ul', null,
                  nameOf2(sv) !== sv.source ? h('li', { className: 'kbcp-good' }, kbt('kb.cp.imp.badname').replace('{name}', nameOf2(sv))) : null,
                  c !== undefined && c.state === 'relative' ? h('li', { className: 'kbcp-good' }, kbt('kb.cp.imp.relative').replace('{cmd}', sv.command).replace('{path}', c.path)) : null,
                  imported.notes.map((n, i) => h('li', { className: 'kbcp-good', key: 'n' + i }, kbt('kb.cp.imp.secret').replace('{what}', n.what).replace('{name}', n.name))),
                  exists(sv) ? h('li', { className: 'kbcp-warnl' }, kbt('kb.cp.imp.exists')) : null,
                  bl.map((t, i) => h('li', { className: 'kbcp-badl', key: 'b' + i }, t))))
            })) : null,
            fails.length > 0 ? h('div', { className: 'kbcp-note bad', role: 'alert' }, fails.map((x, i) => h('div', { key: i }, kbt('kb.cp.imp.failed').replace('{name}', x.name).replace('{why}', x.why)))) : null,
            h('div', { className: 'kb7-actions', style: { justifyContent: 'space-between' } },
              h('span', { className: 'kbcp-help2', style: { flex: 1 } }, kbt('kb.cp.imp.hint')),
              h('div', { className: 'kb7-frow' },
                h('button', { type: 'button', className: 'kbcp-btn', onClick: props.onClose }, kbt('kb.cp.form.cancel')),
                h('button', { type: 'button', className: 'kbcp-btn primary', disabled: busy || servers.length === 0 || servers.every((sv) => blockers(sv).length > 0 || sel[sv.source] === false), onClick: doImport }, kbt('kb.cp.imp.go')))))))
    }

    // The MCP servers tab. Each row says what DSH says of the server; its actions (test, edit, delete,
    // on/off) show when the row is hovered or focused.
    const RECENT_MS = 12000
    const McpPanel = (props) => {
      const items = props.items
      const [tests, setTests] = React.useState({})
      const [confirmDel, setConfirmDel] = React.useState(null)
      const recent = props.recent
      const touch = props.touch
      const [, setTick] = React.useState(0)
      const [busy, setBusy] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const isRecent = (nom) => recent[nom] !== undefined && Date.now() - recent[nom] < RECENT_MS
      // While a server just saved is not loaded yet, ask DSH again every 2 s (it reloads its configuration by itself, about 2 to 3 s after the write).
      const waiting = items.some((c) => isRecent(c.nom) && (c.live === null || c.live === undefined || c.live.loaded !== true || c.live.phase === 'loading' || c.live.phase === 'pending'))
      React.useEffect(() => {
        if (waiting === false) return undefined
        const t1 = setInterval(() => props.reload(), 2000)
        const t2 = setTimeout(() => setTick((n) => n + 1), RECENT_MS + 500)
        return () => { clearInterval(t1); clearTimeout(t2) }
      }, [waiting])
      const runTest = async (c) => {
        setTests((prev) => Object.assign({}, prev, { [c.nom]: { busy: true } }))
        const r = await kbCpHost('/connecteurs/test', 'POST', { nom: c.nom })
        setTests((prev) => Object.assign({}, prev, { [c.nom]: r.status === 200 && r.json !== null && r.json.ok === true ? { result: r.json.result, missing: r.json.missing } : { result: { ok: false, code: r.json !== null && r.json.code !== undefined ? r.json.code : String(r.status), message: r.json !== null && typeof r.json.error === 'string' ? r.json.error : '' }, missing: [] } }))
      }
      const toggle = async (c) => {
        setBusy(c.nom); setErr(null)
        const body = { nom: c.nom, transport: c.transport, url: c.url, command: c.command, args: c.args, cwd: c.cwd, headers: c.headers || [], env: c.env || [], secrets: [], disabled: c.disabled !== true }
        if (c.disabled === true) delete body.disabled
        if (Number.isInteger(c.toolCallTimeoutMs)) body.toolCallTimeoutMs = c.toolCallTimeoutMs
        const r = await kbCpHost('/connecteurs', 'POST', body)
        setBusy(null)
        if (r.status === 200 && r.json !== null && r.json.ok === true) { touch([c.nom]); props.reload() } else setErr(kbt('kb.cp.err.toggle') + ' — ' + (r.json !== null && typeof r.json.error === 'string' ? r.json.error : 'HTTP ' + r.status))
      }
      const remove = async (c) => {
        setBusy(c.nom); setErr(null); setConfirmDel(null)
        const r = await kbCpHost('/connecteurs?nom=' + encodeURIComponent(c.nom), 'DELETE')
        setBusy(null)
        if (r.status === 200 && r.json !== null && r.json.ok === true) { props.toast(kbt('kb.cp.del.done')); props.reload() } else setErr(kbt('kb.cp.err.del') + ' — ' + (r.json !== null && typeof r.json.error === 'string' ? r.json.error : 'HTTP ' + r.status))
      }
      const row = (c) => {
        const st = kbCpStatusOf(c, isRecent(c.nom))
        const t = tests[c.nom]
        const ro = c.editable === false
        const frozen = props.hostOld === true
        return h('div', { className: 'kbcp-mrow', key: c.nom, 'data-kb-server': c.nom },
          h('div', { className: 'kbcp-mmain' },
            h('div', { className: 'kbcp-mid' },
              h('div', { className: 'kbcp-mname' }, c.nom,
                h('span', { className: 'kb7-cxtype' + (c.transport === 'streamable-http' ? ' http' : '') }, c.transport === 'streamable-http' ? 'http' : 'stdio'),
                c.source === 'skill' ? h('span', { className: 'kbcp-src', title: 'connecteur-personnalise' }, kbt('kb.cp.src.skill')) : null,
                ro ? h('span', { className: 'kbcp-src' }, kbt('kb.cp.src.ro')) : null),
              h('div', { className: 'kbcp-mtarget' }, 'mcp__' + c.nom + '__* · ' + kbCpTargetOf(c))),
            h('span', { className: 'kbcp-chip ' + (st.kind === 'plain' ? '' : st.kind), 'data-kb-state': st.key }, h('i'), kbt(st.key).replace('{n}', String(st.n === undefined ? '' : st.n))),
            h('div', { className: 'kbcp-macts' },
              ro || frozen ? null : h('button', { type: 'button', className: 'kbcp-switch', role: 'switch', 'aria-checked': c.disabled === true ? 'false' : 'true', 'aria-label': kbt('kb.cp.act.toggle').replace('{name}', c.nom), disabled: busy === c.nom, onClick: () => toggle(c) }),
              h('button', { type: 'button', className: 'kbcp-btn', disabled: frozen || (t !== undefined && t.busy === true), onClick: () => runTest(c) }, kbt('kb.cp.act.test')),
              h('button', { type: 'button', className: 'kbcp-btn', disabled: frozen, onClick: () => props.edit(c) }, ro ? kbt('kb.cp.src.ro') : kbt('kb.cp.act.edit')),
              h('button', { type: 'button', className: 'kbcp-btn', 'aria-label': kbt('kb.cp.act.del') + ' ' + c.nom, disabled: frozen || busy === c.nom, onClick: () => setConfirmDel(c.nom) }, Icon('trash', 13)))),
          t !== undefined ? h('div', { className: 'kbcp-detail' }, kbCpTestView(t)) : (st.hint !== undefined ? h('div', { className: 'kbcp-detail warn' }, h('span', null, kbt(st.hint))) : null),
          confirmDel === c.nom ? h('div', { className: 'kbcp-confirm' },
            h('p', null, kbt('kb.cp.del.confirm').replace('{name}', c.nom)),
            h('button', { type: 'button', className: 'kbcp-btn', style: { color: 'var(--dsw-alias-state-error-primary,#f25a5a)' }, onClick: () => remove(c) }, kbt('kb.cp.del.go')),
            h('button', { type: 'button', className: 'kbcp-btn', onClick: () => setConfirmDel(null) }, kbt('kb.cp.del.cancel'))) : null)
      }
      return h('div', { className: 'kb7-panel' },
        props.hostOld === true ? h('div', { className: 'kbcp-note warn', role: 'status' }, kbt('kb.cp.hostold')) : null,
        props.note !== null ? h('div', { className: 'kbcp-toast', role: 'status' }, props.note) : null,
        props.error !== null ? h('div', { className: 'kbcp-err', role: 'alert' }, kbt('kb.cp.mcp.error').replace('{why}', props.error)) : null,
        err !== null ? h('div', { className: 'kbcp-err', role: 'alert' }, err) : null,
        items.length === 0 ? h('div', { className: 'kb7-emptybox' }, h('div', { className: 'kb7-empty' }, kbt('kb.cp.mcp.empty'))) : h('div', { className: 'kbcp-mlist' }, items.map(row)))
    }

    // ── Kybernos connections: add window and panel ───────────────────────────────────────────────────────────
    /** Connect an app: pick it in the server's catalogue, name the account, and either go to the app's own page (OAuth) or give its API key. */
    const KcAddModal = (props) => {
      const preset = props.preset !== null && props.preset !== undefined ? props.preset : null
      const [q, setQ] = React.useState('')
      // The server's catalogue holds about a thousand apps: 48 at a time, the rest on demand.
      const [pages, setPages] = React.useState(1)
      const [pick, setPick] = React.useState(preset !== null ? preset.toolkit : null)
      const [alias, setAlias] = React.useState(preset !== null && typeof preset.alias === 'string' ? preset.alias : '')
      const [apiKey, setApiKey] = React.useState('')
      const [needsKey, setNeedsKey] = React.useState(preset !== null && preset.apiKey === true)
      const [busy, setBusy] = React.useState(false)
      const [fail, setFail] = React.useState(null)
      const live = React.useRef(true)
      React.useEffect(() => () => { live.current = false }, [])
      const apps = Array.isArray(props.apps) ? props.apps : null
      const app = pick === null ? null : ((apps || []).find((a) => a.slug === pick) || { slug: pick, name: nameOf(pick), needsApiKey: false })
      const wantsKey = app !== null && (app.needsApiKey === true || needsKey === true)
      const full = props.limit !== null && props.count >= props.limit
      const found = kbCpAppsMatch(apps, q, Infinity)
      const matches = found.slice(0, KC_PAGE * pages)
      const submit = async () => {
        if (app === null || busy === true) return
        if (wantsKey && apiKey.trim().length === 0) { setFail({ error: 'needs_api_key', details: {} }); return }
        setBusy(true); setFail(null)
        const body = { toolkit: app.slug }
        if (alias.trim().length > 0) body.alias = alias.trim()
        if (wantsKey) body.api_key = apiKey
        const r = await kbCpCloud('/connections/link', 'POST', body)
        if (live.current === false) return
        setBusy(false)
        const j = r.json
        if (r.status === 200 && j !== null && j.ok === true && j.connection !== null && typeof j.connection === 'object') { setApiKey(''); props.onLinked({ app: app, connection: j.connection, redirectUrl: j.redirectUrl }); return }
        const word = j !== null && typeof j.error === 'string' ? j.error : (r.status === 0 ? 'network' : 'other')
        if (word === 'needs_api_key') setNeedsKey(true)
        setFail({ error: word, details: j !== null && typeof j === 'object' ? j : {} })
      }
      const existing = fail !== null && fail.error === 'pending_exists' && fail.details.existing !== null && typeof fail.details.existing === 'object' ? fail.details.existing : null
      return h('div', { className: 'kb7-overlay', onClick: props.onClose },
        h('div', { className: 'kb7-modal', style: { maxWidth: 620 }, role: 'dialog', 'aria-modal': 'true', 'aria-label': kbt('kb.cp.kc.m.title'), onClick: (e) => e.stopPropagation() },
          h('div', { className: 'kb7-mhead' },
            h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { className: 'kb7-mname' }, kbt('kb.cp.kc.m.title'))),
            h('button', { type: 'button', className: 'kbcp-btn', onClick: props.onClose, 'aria-label': kbt('kb.cp.close') }, Icon('x', 14))),
          h('div', { className: 'kb7-form' },
            h('div', null,
              h('label', { className: 'kb7-flabel', htmlFor: 'kbcp-kc-q' }, kbt('kb.cp.kc.m.search')),
              h('input', { className: 'kb7-finput', id: 'kbcp-kc-q', value: q, placeholder: 'Gmail, GitHub, Slack…', autoComplete: 'off', spellCheck: false, onChange: (e) => { setQ(e.target.value); setPages(1) } })),
            apps === null ? h('div', { className: 'kbcp-help2' }, kbt('kb.cp.loading'))
              : (matches.length === 0 ? h('div', { className: 'kbcp-help2' }, kbt('kb.cp.kc.m.noapps'))
                : h(React.Fragment, null,
                  h('div', { className: 'kbcp-kcpick', role: 'listbox', 'aria-label': kbt('kb.cp.kc.m.title') },
                    matches.map((a) => h('button', { type: 'button', key: a.slug, className: 'kbcp-kcapp' + (pick === a.slug ? ' on' : ''), role: 'option', 'aria-selected': pick === a.slug ? 'true' : 'false', 'data-kb-app': a.slug, onClick: () => { setPick(a.slug); setFail(null); setNeedsKey(false) } },
                      AppLogo(a.slug, 28),
                      h('span', null, h('b', null, a.name), h('small', null, a.needsApiKey === true ? kbt('kb.cp.kc.type.api_key') : 'OAuth'))))),
                  found.length > matches.length ? h('button', { type: 'button', className: 'kbcp-btn', style: { alignSelf: 'flex-start' }, 'data-kb': 'kc-more', onClick: () => setPages(pages + 1) }, kbt('kb.cp.kc.m.more').replace('{n}', String(found.length - matches.length))) : null)),
            app !== null ? h('div', null,
              h('label', { className: 'kb7-flabel', htmlFor: 'kbcp-kc-alias' }, kbt('kb.cp.kc.m.alias')),
              h('input', { className: 'kb7-finput', id: 'kbcp-kc-alias', value: alias, maxLength: 64, placeholder: 'pro, perso…', autoComplete: 'off', spellCheck: false, onChange: (e) => setAlias(e.target.value) }),
              h('div', { className: 'kbcp-help2' }, kbt('kb.cp.kc.m.alias.hint').replace('{app}', app.name))) : null,
            app !== null && wantsKey ? h('div', null,
              h('label', { className: 'kb7-flabel', htmlFor: 'kbcp-kc-key' }, kbt('kb.cp.kc.m.key').replace('{app}', app.name)),
              h('input', { className: 'kb7-finput', id: 'kbcp-kc-key', type: 'password', value: apiKey, autoComplete: 'off', spellCheck: false, onChange: (e) => setApiKey(e.target.value) }),
              h('div', { className: 'kbcp-help2' }, kbt('kb.cp.kc.m.key.hint'))) : null,
            app !== null && !wantsKey ? h('div', { className: 'kbcp-note' }, kbt('kb.cp.kc.m.oauth').replace('{app}', app.name)) : null,
            fail !== null ? h('div', { className: 'kbcp-note ' + (fail.error === 'needs_api_key' ? '' : 'bad'), role: 'alert' },
              h('div', null, kbCpCloudErr(fail.error, fail.details)),
              fail.details.checkFirst === true ? h('div', { className: 'kbcp-kcrow' }, kbt('kb.cp.kc.check'), h('button', { type: 'button', className: 'kbcp-btn', onClick: props.onCheck }, kbt('kb.cp.kc.check.go'))) : null,
              existing !== null ? h('div', { className: 'kbcp-kcrow' }, h('button', { type: 'button', className: 'kbcp-btn', onClick: () => props.onCancelExisting(existing.id).then(() => { if (live.current === true) setFail(null) }) }, kbt('kb.cp.kc.act.cancelreq'))) : null) : null,
            h('div', { className: 'kb7-actions', style: { justifyContent: 'space-between' } },
              h('span', { className: 'kbcp-help2' }, props.limit !== null ? kbt('kb.cp.kc.m.used').replace('{count}', String(props.count)).replace('{limit}', String(props.limit)) : ''),
              h('div', { className: 'kb7-frow' },
                h('button', { type: 'button', className: 'kbcp-btn', onClick: props.onClose }, kbt('kb.cp.form.cancel')),
                h('button', { type: 'button', className: 'kbcp-btn primary', 'data-kb': 'kc-link', disabled: busy || app === null || full, onClick: submit }, busy === true ? kbt('kb.cp.form.saving') : (app !== null && !wantsKey ? kbt('kb.cp.kc.m.go').replace('{app}', app.name) : kbt('kb.cp.kc.m.go.key'))))))))
    }

    /** The account's connected apps (mode « Kybernos connections »): the list, its states, and what to do about each. */
    const KybernosPanel = (props) => {
      const kc = props.kc
      const [apps, setApps] = React.useState(null)
      const [modal, setModal] = React.useState(null)
      const [confirmDel, setConfirmDel] = React.useState(null)
      const [busy, setBusy] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [pair, setPair] = React.useState(null)
      const [, setTick] = React.useState(0)
      const seen = React.useRef({})
      const live = React.useRef(true)
      React.useEffect(() => () => { live.current = false }, [])
      const appName = (slug) => { const known = (apps || []).find((a) => a.slug === slug); return known !== undefined ? known.name : nameOf(slug) }
      const full = kc.limit !== null && kc.count >= kc.limit
      const fail = (r) => { const j = r.json; setErr({ error: j !== null && typeof j.error === 'string' ? j.error : (r.status === 0 ? 'network' : 'other'), details: j !== null && typeof j === 'object' ? j : {} }) }

      // The server's catalogue (names for the rows, and the add window): once, when the account is connected.
      React.useEffect(() => {
        if (kc.connected === false || apps !== null) return undefined
        let alive = true
        kbCpCloud('/connections/apps').then((r) => { if (alive === true) setApps(r.status === 200 && r.json !== null && r.json.ok === true && Array.isArray(r.json.apps) ? r.json.apps : []) })
        return () => { alive = false }
      }, [kc.connected])

      // A pending connection is asked about every 5 s, for 10 minutes at most; the server reconciles that one connection on the spot.
      const pending = kc.connections.filter((c) => c.status === 'pending')
      const pendingKey = pending.map((c) => c.id).join(',')
      React.useEffect(() => {
        if (pendingKey === '') return undefined
        let alive = true
        const now = Date.now()
        for (const c of pending) if (seen.current[c.id] === undefined) seen.current[c.id] = now
        const tick = async () => {
          for (const c of pending) {
            if (alive === false) return
            if (Date.now() - seen.current[c.id] > KC_POLL_MAX_MS) { setTick((n) => n + 1); continue }
            const r = await kbCpCloud('/connections/item?id=' + encodeURIComponent(c.id))
            if (alive === false) return
            if (r.status === 200 && r.json !== null && r.json.ok === true && r.json.connection !== null && typeof r.json.connection === 'object') {
              if (r.json.connection.status !== 'pending') { props.patch(r.json.connection); if (r.json.connection.status === 'active') props.flash(kbt('kb.cp.kc.done.active').replace('{app}', appName(c.toolkit))) }
            } else if (r.json !== null && r.json.error === 'not_found') props.reload(false)
          }
        }
        const t = setInterval(tick, KC_POLL_MS)
        return () => { alive = false; clearInterval(t) }
      }, [pendingKey])

      // Sign-in without leaving the page: the cloud half starts the pairing, the person approves it in a tab, this asks every 3 s.
      React.useEffect(() => {
        if (pair === null || pair.failed === true) return undefined
        let alive = true
        const t = setInterval(async () => {
          const r = await kbCpCloud('/poll', 'POST')
          if (alive === false) return
          const j = r.json
          if (j !== null && j.ok === true && j.connected === true) { setPair(null); props.reload(false) }
          else if (j !== null && j.ok === true && (j.status === 'denied' || j.status === 'expired' || j.status === 'none')) setPair(Object.assign({}, pair, { failed: true }))
        }, 3000)
        return () => { alive = false; clearInterval(t) }
      }, [pair])
      const signIn = async () => {
        setErr(null)
        const r = await kbCpCloud('/start', 'POST')
        if (live.current === false) return
        const j = r.json
        if (j !== null && j.ok === true && j.connected === true) { props.reload(false); return }
        if (j !== null && j.ok === true && j.pairing !== null && typeof j.pairing === 'object') {
          const url = kbCpWebUrl(j.pairing.activation_url)
          setPair({ code: j.pairing.user_code, url: url, failed: false })
          if (url !== null) { try { window.open(url, '_blank', 'noopener,noreferrer') } catch (e) { /* the button below opens it */ } }
          return
        }
        setErr({ error: 'signin_failed', details: {} })
      }

      const linked = (res) => {
        setModal(null)
        const name = res.app.name !== undefined ? res.app.name : appName(res.app.slug)
        const url = kbCpWebUrl(res.redirectUrl)
        if (url !== null) {
          kbCpSaveLink('kc:' + res.connection.id, url)
          try { window.open(url, '_blank', 'noopener,noreferrer') } catch (e) { /* the pending row keeps a button that opens it */ }
          props.flash(kbt('kb.cp.kc.done.opened').replace('{app}', name))
        } else props.flash(kbt('kb.cp.kc.done.active').replace('{app}', name))
        props.reload(false)
      }
      const del = async (id) => {
        const r = await kbCpCloud('/connections/delete', 'POST', { id: id })
        const ok = r.status === 200 && r.json !== null && (r.json.ok === true || r.json.error === 'not_found')
        return { ok: ok, r: r }
      }
      const remove = async (c) => {
        setBusy(c.id); setErr(null); setConfirmDel(null)
        const d = await del(c.id)
        if (live.current === false) return
        setBusy(null)
        if (d.ok === true) { props.flash(kbt('kb.cp.kc.done.removed')); props.reload(false) } else fail(d.r)
      }
      /** Failed, expired or disabled: remove it (that frees its place), then link again. An API-key connection needs its key again, so the window opens. */
      const redo = async (c) => {
        setBusy(c.id); setErr(null)
        const d = await del(c.id)
        if (live.current === false) return
        if (d.ok !== true) { setBusy(null); fail(d.r); return }
        if (c.accountType === 'api_key') { setBusy(null); props.reload(false); setModal({ preset: { toolkit: c.toolkit, alias: c.alias, apiKey: true } }); return }
        const body = { toolkit: c.toolkit }
        if (typeof c.alias === 'string' && c.alias.length > 0) body.alias = c.alias
        const r = await kbCpCloud('/connections/link', 'POST', body)
        if (live.current === false) return
        setBusy(null)
        if (r.status === 200 && r.json !== null && r.json.ok === true && r.json.connection !== null && typeof r.json.connection === 'object') linked({ app: { slug: c.toolkit, name: appName(c.toolkit) }, connection: r.json.connection, redirectUrl: r.json.redirectUrl })
        else { props.reload(false); fail(r) }
      }

      const row = (c) => {
        const st = kbCpConnState(c.status)
        const name = appName(c.toolkit)
        const q = props.query
        if (q.length >= 2 && (name + ' ' + c.toolkit + ' ' + (c.alias || '')).toLowerCase().indexOf(q) < 0) return null
        const acts = kbCpConnActions(c.status)
        const link = c.status === 'pending' ? kbCpGetLink('kc:' + c.id) : null
        const waited = c.status === 'pending' && seen.current[c.id] !== undefined && Date.now() - seen.current[c.id] > KC_POLL_MAX_MS
        const act = (a) => {
          if (a === 'cancel') return h('button', { type: 'button', key: a, className: 'kbcp-btn', disabled: busy === c.id, onClick: () => remove(c) }, kbt('kb.cp.kc.act.cancel'))
          if (a === 'retry' || a === 'reconnect') return h('button', { type: 'button', key: a, className: 'kbcp-btn', disabled: busy === c.id, onClick: () => redo(c) }, kbt(a === 'retry' ? 'kb.cp.kc.act.retry' : 'kb.cp.kc.act.reconnect'))
          return h('button', { type: 'button', key: a, className: 'kbcp-btn', 'aria-label': kbt('kb.cp.kc.act.remove') + ' ' + name, disabled: busy === c.id, onClick: () => setConfirmDel(c.id) }, Icon('trash', 13))
        }
        return h('div', { className: 'kbcp-mrow', key: c.id, 'data-kb-conn': c.id, 'data-kb-status': c.status },
          h('div', { className: 'kbcp-mmain' },
            AppLogo(c.toolkit, 34),
            h('div', { className: 'kbcp-mid' },
              h('div', { className: 'kbcp-mname' }, name,
                c.alias !== null ? h('span', { className: 'kbcp-src' }, c.alias) : null,
                h('span', { className: 'kb7-cxtype' }, c.accountType === 'api_key' ? kbt('kb.cp.kc.type.api_key') : 'OAuth'),
                c.isDefault === true && c.status === 'active' ? h('span', { className: 'kb7-cxtype http' }, kbt('kb.cp.kc.default')) : null),
              h('div', { className: 'kbcp-mtarget' }, c.toolkit)),
            h('span', { className: 'kbcp-chip ' + (st.kind === 'plain' ? '' : st.kind), 'data-kb-state': c.status }, h('i'), kbt(st.key)),
            h('div', { className: 'kbcp-macts' }, acts.map(act))),
          c.status === 'pending' ? h('div', { className: 'kbcp-detail warn' },
            h('span', null, h('b', null, waited === true ? kbt('kb.cp.kc.pend.timeout') : kbt('kb.cp.kc.pend').replace('{app}', name))),
            waited === true ? null : h('span', { className: 'kbcp-help2' }, kbt('kb.cp.kc.pend.sub')),
            link !== null && waited !== true ? h('a', { className: 'kbcp-btn', style: { alignSelf: 'flex-start', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }, href: link, target: '_blank', rel: 'noopener noreferrer' }, kbt('kb.cp.kc.pend.open')) : null) : null,
          c.status === 'failed' ? h('div', { className: 'kbcp-detail bad' }, h('span', null, h('b', null, kbCpFailedText(c.failure, name)), ' ' + kbt('kb.cp.kc.failed.hint'))) : null,
          c.status === 'expired' ? h('div', { className: 'kbcp-detail warn' }, h('span', null, kbt('kb.cp.kc.expired'))) : null,
          c.status === 'disabled' ? h('div', { className: 'kbcp-detail warn' }, h('span', null, kbt('kb.cp.kc.disabled'))) : null,
          confirmDel === c.id ? h('div', { className: 'kbcp-confirm' },
            h('p', null, kbt('kb.cp.kc.del.confirm').replace('{name}', name + (c.alias !== null ? ' (' + c.alias + ')' : ''))),
            h('button', { type: 'button', className: 'kbcp-btn', style: { color: 'var(--dsw-alias-state-error-primary,#f25a5a)' }, onClick: () => remove(c) }, kbt('kb.cp.kc.act.remove')),
            h('button', { type: 'button', className: 'kbcp-btn', onClick: () => setConfirmDel(null) }, kbt('kb.cp.del.cancel'))) : null)
      }

      if (kc.connected === false) {
        return h('div', { className: 'kb7-emptybox', 'data-kb': 'kc-signin' },
          h('div', { className: 'kb7-empty' }, h('b', null, kbt('kb.cp.kc.signin.title')), h('br'), kbt('kb.cp.kc.signin.body')),
          pair === null || pair.failed === true ? h('button', { type: 'button', className: 'kbcp-btn primary', onClick: signIn }, kbt('kb.cp.kc.signin.go')) : h('div', { className: 'kbcp-note', role: 'status' },
            h('div', null, kbt('kb.cp.kc.signin.wait')),
            pair.code ? h('div', null, kbt('kb.cp.kc.signin.code').replace('{code}', String(pair.code))) : null,
            pair.url !== null ? h('a', { className: 'kbcp-btn', style: { alignSelf: 'flex-start', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', marginTop: 6 }, href: pair.url, target: '_blank', rel: 'noopener noreferrer' }, kbt('kb.cp.kc.signin.open')) : null),
          pair !== null && pair.failed === true ? h('div', { className: 'kbcp-err', role: 'alert' }, kbCpCloudErr('signin_failed')) : null,
          err !== null ? h('div', { className: 'kbcp-err', role: 'alert' }, kbCpCloudErr(err.error, err.details)) : null)
      }
      const shown = kc.connections.map(row).filter((x) => x !== null)
      const meter = []
      if (kc.limit !== null) for (let i = 0; i < kc.limit && i < 20; i++) meter.push(h('i', { key: i, className: i < kc.connections.length ? (kc.connections[i].status === 'pending' ? 'pend' : 'on') : '' }))
      const bannerErr = err !== null ? err : (kc.error !== null ? { error: kc.error, details: kc.details } : null)
      return h('div', { className: 'kbcp-kc' },
        h('div', { className: 'kbcp-kcmeter' },
          h('b', null, kc.limit !== null ? kbt('kb.cp.kc.meter').replace('{count}', String(kc.count)).replace('{limit}', String(kc.limit)) : kbt('kb.cp.kc.meter.nolimit').replace('{count}', String(kc.count))),
          kc.limit !== null ? h('span', { className: 'kbcp-kcbar', 'aria-hidden': 'true' }, meter) : null,
          h('span', { className: 'kbcp-help2' }, kbt('kb.cp.kc.meter.note')),
          h('button', { type: 'button', className: 'kbcp-btn primary', style: { marginLeft: 'auto' }, 'data-kb': 'kc-add', disabled: full, onClick: () => setModal({ preset: null }) }, Icon('plus', 13), ' ' + kbt('kb.cp.kc.add'))),
        full ? h('div', { className: 'kbcp-help2' }, kbt('kb.cp.kc.full').replace(/\{limit\}/g, String(kc.limit))) : null,
        props.note !== null ? h('div', { className: 'kbcp-toast', role: 'status' }, props.note) : null,
        kc.stale === true && bannerErr === null ? h('div', { className: 'kbcp-note warn', role: 'status' }, kbt('kb.cp.kc.stale'), ' ', h('button', { type: 'button', className: 'kbcp-btn', onClick: () => props.reload(true) }, kbt('kb.cp.kc.refresh'))) : null,
        bannerErr !== null ? h('div', { className: 'kbcp-err', role: 'alert' },
          kbCpCloudErr(bannerErr.error, bannerErr.details),
          bannerErr.details !== null && bannerErr.details.checkFirst === true ? h('button', { type: 'button', className: 'kbcp-btn', style: { marginLeft: 8 }, onClick: () => { setErr(null); props.reload(true) } }, kbt('kb.cp.kc.check.go')) : null,
          bannerErr.error === 'reconnect_required' ? h('button', { type: 'button', className: 'kbcp-btn', style: { marginLeft: 8 }, onClick: signIn }, kbt('kb.cp.kc.signin.go')) : null,
          err !== null ? h('button', { type: 'button', className: 'kbcp-btn', style: { marginLeft: 8 }, 'aria-label': kbt('kb.cp.dismiss'), onClick: () => setErr(null) }, Icon('x', 12)) : null) : null,
        shown.length === 0
          ? h('div', { className: 'kb7-emptybox' }, h('div', { className: 'kb7-empty' }, kc.connections.length > 0 ? kbt('kb.cp.empty') : kbt('kb.cp.kc.empty')))
          : h('div', { className: 'kbcp-mlist' }, shown),
        modal !== null ? h(KcAddModal, {
          apps: apps, preset: modal.preset, limit: kc.limit, count: kc.count,
          onClose: () => setModal(null),
          onLinked: linked,
          onCheck: () => { setModal(null); props.reload(true) },
          onCancelExisting: async (id) => { const d = await del(id); props.reload(false); return d },
        }) : null)
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
      // Whether the host has a Composio key: null until it has answered, so the "add your key" banner never flashes.
      const p17 = React.useState(null)
      const hostCfg = p17[0]
      const setHostCfg = p17[1]
      // The MCP servers tab: what the host said about the list, the add menu, the JSON window, and the servers saved a moment ago.
      const [mcpErr, setMcpErr] = React.useState(null)
      const [hostOld, setHostOld] = React.useState(false)
      const [roots, setRoots] = React.useState(null)
      const [menuOpen, setMenuOpen] = React.useState(false)
      const [importOpen, setImportOpen] = React.useState(false)
      const [recent, setRecent] = React.useState({})
      // Kybernos connections, the second mode of "Yours": null until the cloud half has answered, { offered: false } when this server
      // (or an older cloud half on this machine) does not offer it, and then the mode is not shown at all.
      const [kc, setKc] = React.useState(null)
      const [mode, setModeState] = React.useState(kbCpModeGet())
      const reloadKc = React.useCallback(async (fresh) => {
        const r = await kbCpCloud('/connections' + (fresh === true ? '?refresh=1' : ''))
        setKc((prev) => kbCpCloudMerge(prev, kbCpCloudView(r)))
      }, [])
      React.useEffect(() => { reloadKc(false) }, [reloadKc])
      const patchKc = React.useCallback((conn) => setKc((prev) => (prev === null || prev.offered !== true ? prev : Object.assign({}, prev, { connections: prev.connections.map((c) => (c.id === conn.id ? conn : c)) }))), [])
      const setMode = (m) => { setModeState(m); kbCpModeSet(m) }
      const touch = React.useCallback((noms) => setRecent((prev) => { const n = Object.assign({}, prev); for (const x of noms) n[x] = Date.now(); return n }), [])

      const loadConnecteurs = React.useCallback(async () => {
        const r = await kbCpHost('/connecteurs')
        if (r.status !== 200 || r.json === null || r.json.ok !== true) {
          // The host says why when it cannot list them (a corrupt or unreadable file); no answer at all stays quiet.
          if (r.json !== null && typeof r.json.error === 'string') setMcpErr(r.json.error)
          return
        }
        setHostOld(kbCpHostIsOld(r.json))
        setCx(Array.isArray(r.json.connecteurs) === true ? r.json.connecteurs : [])
        setRoots(r.json.roots !== undefined ? r.json.roots : null)
        setMcpErr(typeof r.json.error === 'string' && r.json.error.length > 0 ? r.json.error : null)
      }, [])
      React.useEffect(() => { loadConnecteurs() }, [loadConnecteurs])

      /** Refreshes the connections of the apps shown, 40 at a time, from the host (which holds the key). */
      const refresh = React.useCallback(async (list, retry) => {
        // OPT-IN retry: only the Refresh click passes retry = true. The host catalog does not depend on the
        // key, so the retry comes first; the catOk gate avoids any catalog fetch when a non-empty catalog is already held.
        if (retry === true && catOk === false) {
          try {
            const fresh = await kbCpCatalog()
            // SUCCESSFUL retry: the catalog error is cleared BEFORE any early return (otherwise a red banner would survive the reload).
            setErr(null)
            // A NON-EMPTY caller list is never overwritten: the refetch only serves to refill CATALOG/catOk.
            // Empty list: the fresh list is adopted and the grid refilled, as the mount does.
            if (!list || list.length === 0) {
              list = fresh
              if (fresh.length > 0) setApps(fresh)
            }
          } catch (e) {
            setErr(kbt('kb.cp.err.catalog') + ': ' + String((e && e.message) || e))
            setConns({})
            return
          }
        }
        setBusy(true)
        setErr(null)
        const sl = (list || CATALOG).map((a) => a && a.s).filter((x) => typeof x === 'string' && x.length > 0)
        const acc = {}
        // The first failure the host reports (401, 429, timeout...) is shown: an empty list that comes with an error is NOT "no app connected".
        let failure = null
        let configured = null
        for (let i = 0; i < sl.length; i += 40) {
          const r = await kbCpHost('/connections?toolkits=' + encodeURIComponent(sl.slice(i, i + 40).join(',')))
          if (r.status !== 200 || r.json === null) { failure = r.status === 0 ? 'offline' : String(r.status); break }
          if (r.json.configured === true) configured = true
          else if (configured === null) configured = false
          if (failure === null && r.json.configured === true && typeof r.json.error === 'string' && r.json.error.length > 0) failure = r.json.error
          for (const c of (Array.isArray(r.json.connections) ? r.json.connections : [])) {
            const key = String((c && c.toolkit) || '').toLowerCase()
            if (key.length === 0) continue
            acc[key] = {
              status: String((c && c.status) || '').toLowerCase(),
              accounts: (Array.isArray(c && c.accounts) ? c.accounts : []).map((a) => ({
                id: String((a && a.id) || ''),
                label: String((a && (a.alias || a.accountType || a.id)) || ''),
                status: String((a && a.status) || '').toUpperCase(),
              })),
            }
          }
        }
        setConns(acc)
        setHostCfg(configured)
        if (failure !== null) setErr(kbCpErrText(failure))
        setBusy(false)
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
        const on = () => { refresh(apps) }
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

      /** Connect: the host starts the connection and gives the address where the person authorizes it. */
      const connect = async (slug) => {
        setErr(null)
        setBusy(true)
        const r = await kbCpHost('/accounts', 'POST', { action: 'add', toolkit: slug })
        setBusy(false)
        if (r.status !== 200 || r.json === null || r.json.ok !== true) {
          const code = r.json !== null && r.json.code !== undefined ? String(r.json.code) : (r.status === 0 ? 'offline' : String(r.status))
          // No such route: the host half is older than this page.
          setErr(r.status === 404 && r.json === null ? kbt('kb.cp.hostold') : (code === 'no-credential' ? kbt('kb.cp.nokey') : kbCpErrText(code)))
          return
        }
        // The host only passes on an http(s) address; one that is not is never opened.
        const url = kbCpWebUrl(r.json.redirectUrl) || kbCpGetLink(slug)
        if (url !== null) {
          kbCpSaveLink(slug, url)
          window.open(url, '_blank', 'noopener')
          setAuthLinks((prev) => Object.assign({}, prev, { [slug]: url }))
        } else if (typeof r.json.redirectUrl === 'string' && r.json.redirectUrl.length > 0) setErr('Authorization link refused: it is not an http(s) address.')
        // The account shows up as "initiated": it is displayed right away.
        const conn = r.json.connection
        const show = (c) => setConns((prev) => Object.assign({}, prev, { [slug]: { status: String(c.status || ''), accounts: (Array.isArray(c.accounts) ? c.accounts : []).map((a) => ({ id: String(a.id || ''), label: String(a.alias || a.accountType || a.id || ''), status: String(a.status || '').toUpperCase() })) } }))
        if (conn !== null && conn !== undefined) show(conn)
        // Ask again until the account is ACTIVE (2 min 30): the person is authorizing in the other tab.
        const deadline = Date.now() + 150000
        const poll = async () => {
          while (Date.now() < deadline) {
            await new Promise((res) => setTimeout(res, 5000))
            const p = await kbCpHost('/connections?toolkits=' + encodeURIComponent(slug) + '&fresh=1')
            if (p.status !== 200 || p.json === null || !Array.isArray(p.json.connections) || p.json.error) continue
            const c = p.json.connections.find((x) => x && x.toolkit === slug)
            if (c === undefined) continue
            show(c)
            if ((c.accounts || []).some((a) => String(a.status).toUpperCase() === 'ACTIVE')) {
              setAuthLinks((prev) => { const n = Object.assign({}, prev); delete n[slug]; return n })
              return
            }
          }
        }
        poll()
      }

      /** Removes ONE given account. */
      const removeAccount = async (slug, accountId) => {
        setErr(null)
        const r = await kbCpHost('/accounts', 'POST', { action: 'remove', toolkit: slug, accountId: accountId })
        if (r.status !== 200 || r.json === null || r.json.ok !== true) {
          const code = r.json !== null && r.json.code !== undefined ? String(r.json.code) : (r.status === 0 ? 'offline' : String(r.status))
          setErr(r.status === 404 && r.json === null ? kbt('kb.cp.hostold') : kbt('kb.cp.err.remove') + ': ' + kbCpErrText(code))
          return
        }
        const c = r.json.connection
        if (c !== null && c !== undefined) setConns((prev) => Object.assign({}, prev, { [slug]: { status: String(c.status || ''), accounts: (Array.isArray(c.accounts) ? c.accounts : []).map((a) => ({ id: String(a.id || ''), label: String(a.alias || a.accountType || a.id || ''), status: String(a.status || '').toUpperCase() })) } }))
      }

      /** After a server was saved or imported: note it, mark it as just saved (DSH reloads in a few seconds), list again. */
      const flash = (msg) => { setCxNote(msg); setTimeout(() => setCxNote((cur) => (cur === msg ? null : cur)), 6000) }
      const savedServers = (noms, note) => {
        touch(noms)
        flash(note)
        setCxForm(null)
        setImportOpen(false)
        setVtab('mcp')
        loadConnecteurs()
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
      // The mode in force: Kybernos connections only when this server offers them, else the person's own key, as before.
      const effMode = kc !== null && kc.offered === true && mode === 'kybernos' ? 'kybernos' : 'personal'
      const kcMode = effMode === 'kybernos'

      return h('div', { className: 'kb7-root' },
        h('div', { className: 'kb7-head', style: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 } },
          h('div', { style: { flex: 1, minWidth: 0 } },
            // (29/09) h2: the page already carries its title (kb6-title): a single
            // heading level per page, the section subtitle stays an h2.
            h('div', { className: 'kb7-titlerow' },
              h('h2', { className: 'kb7-h1' }, kbt('kb.cp.title')),
              h('button', { type: 'button', className: 'kb7-infobtn' + (helpOpen === true ? ' on' : ''), 'aria-label': kbt('kb.cp.info'), title: kbt('kb.cp.info'), 'aria-expanded': helpOpen === true ? 'true' : 'false', 'data-kb': 'connectors-help', onClick: () => setHelpOpen(!helpOpen) }, Icon('info', 14))),
            h('p', { className: 'kb7-sub', title: kbt('kb.cp.sub') }, kbt('kb.cp.sub'))),
          // Same visual language as "Create with AI" on the other pages (class kb8-primary of the
          // kybernos bundle). It always adds an MCP server: with a form, or by pasting the JSON of a documentation.
          h('div', { className: 'kbcp-addwrap' },
            h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'connector-create', 'aria-haspopup': 'menu', 'aria-expanded': menuOpen ? 'true' : 'false', style: { flex: 'none', height: 38, padding: '0 14px', fontSize: 13, borderRadius: 10 }, disabled: hostOld, onClick: () => setMenuOpen(!menuOpen) }, Icon('plus', 16), kbt('kb.cp.add') + ' ▾'),
            menuOpen ? h('div', { className: 'kbcp-menu', role: 'menu' },
              h('button', { type: 'button', role: 'menuitem', 'data-kb': 'add-form', onClick: () => { setMenuOpen(false); setCxForm({ initial: null }) } }, kbt('kb.cp.add.form'), h('small', null, kbt('kb.cp.add.formhint'))),
              h('button', { type: 'button', role: 'menuitem', 'data-kb': 'add-json', onClick: () => { setMenuOpen(false); setImportOpen(true) } }, kbt('kb.cp.add.json'), h('small', null, kbt('kb.cp.add.jsonhint')))) : null)),
        // Control row ("Resources" mockup 29/09): pill sub-tabs on the LEFT,
        // search/filters/sort block on the RIGHT: same design
        // and same position as the other pages, the content varies by tab.
        h('div', { className: 'kb7-ctlrow' },
          h('div', { className: 'kb7-subtabs', role: 'tablist' },
            h('button', { type: 'button', role: 'tab', 'aria-selected': vtab === 'yours' ? 'true' : 'false', className: 'kb7-subtab' + (vtab === 'yours' ? ' on' : ''), 'data-kb': 'subtab-yours', onClick: () => setVtab('yours') },
              kbt('kb.cp.tab.yours'), (kcMode ? kc.count : totalConn) > 0 ? h('span', { className: 'kb7-cxcount' }, String(kcMode ? kc.count : totalConn)) : null),
            h('button', { type: 'button', role: 'tab', 'aria-selected': vtab === 'discover' ? 'true' : 'false', className: 'kb7-subtab' + (vtab === 'discover' ? ' on' : ''), 'data-kb': 'subtab-discover', onClick: () => setVtab('discover') },
              kbt('kb.cp.tab.discover'), apps.length > 0 ? h('span', { className: 'kb7-cxcount' }, String(apps.length)) : null),
            h('button', { type: 'button', role: 'tab', 'aria-selected': vtab === 'mcp' ? 'true' : 'false', className: 'kb7-subtab' + (vtab === 'mcp' ? ' on' : ''), 'data-kb': 'subtab-mcp', onClick: () => setVtab('mcp') },
              kbt('kb.cp.tab.mcp'), cx.length > 0 ? h('span', { className: 'kb7-cxcount' }, String(cx.length)) : null)),
          // Unified bar on the RIGHT of the row (mockup): visible on
          // "Discover" only; Refresh / Load all as trailing items.
          (kbTb !== null && vtab !== 'mcp' ? h(kbTb.KbToolbar, {
            state: Object.assign({}, tbState, { dir: cpDir }),
            onUpdate: onCpUpdate,
            searchPlaceholder: kbt('kb.cp.search'),
            sortOptions: [{ id: 'name', label: kbt('kbui.sort.az') }],
            facets: { type: { options: vtab === 'discover' ? facetOptions : (kcMode ? [] : yoursFacet) } },
            total: vtab === 'discover' ? apps.length : (kcMode ? kc.connections.length : yoursPool.length),
            shown: vtab === 'discover' ? list.length : (kcMode ? kc.connections.length : yoursList.length),
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
        (vtab !== 'mcp' && kcMode === false && ready === true && hostCfg === false && Object.keys(conns).length === 0) ? h('div', { className: 'kb7-nokey' }, Icon('key', 15), kbt('kb.cp.nokey')) : null,
        err !== null && (vtab !== 'yours' || kcMode === false) ? h('div', { className: 'kbcp-err', role: 'alert' }, err) : null,
        // ── Vos connexions ──────────────────────────────────────────────────
        vtab === 'yours' ? h('div', { className: 'kb7-panel' },
          kc !== null && kc.offered === true ? h('div', { className: 'kbcp-modebar' },
            h('div', { className: 'kb7-fseg', role: 'group', 'aria-label': kbt('kb.cp.kc.mode.label') },
              h('button', { type: 'button', className: kcMode ? '' : 'on', 'aria-pressed': kcMode ? 'false' : 'true', 'data-kb': 'mode-personal', onClick: () => setMode('personal') }, kbt('kb.cp.kc.mode.personal')),
              h('button', { type: 'button', className: kcMode ? 'on' : '', 'aria-pressed': kcMode ? 'true' : 'false', 'data-kb': 'mode-kybernos', onClick: () => setMode('kybernos') }, kbt('kb.cp.kc.mode.kybernos'))),
            h('span', { className: 'kbcp-help2' }, kbt(kcMode ? 'kb.cp.kc.mode.hint.kybernos' : 'kb.cp.kc.mode.hint.personal'))) : null,
          kcMode ? h(KybernosPanel, { kc: kc, reload: reloadKc, patch: patchKc, flash: flash, note: cxNote, query: qn }) : yoursList.length === 0
            ? (ready === true ? h('div', { className: 'kb7-emptybox' },
                h('div', { className: 'kb7-empty' }, yoursPool.length > 0 ? kbt('kb.cp.empty') : (err !== null ? err : kbt('kb.cp.yours.empty'))),
                yoursPool.length > 0 ? null : h('button', { type: 'button', className: 'kbcp-btn', onClick: () => setVtab('discover') }, kbt('kb.cp.yours.go'))) : h('div', { className: 'kb7-emptybox' }, h('div', { className: 'kb7-empty' }, kbt('kb.cp.loading'))))
            : h('div', { className: 'kb7-grid' }, yoursList.map((a) => appCard(a)))
        ) : null,
        // ── MCP servers ─────────────────────────────────────────────────────
        vtab === 'mcp' ? h(McpPanel, { items: cx, hostOld: hostOld, error: mcpErr, note: cxNote, recent: recent, touch: touch, reload: loadConnecteurs, toast: flash, edit: (c) => setCxForm({ initial: c }) }) : null,
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
          onSaved: (nom) => savedServers([nom], kbt('kb.cp.form.saved')),
          onClose: () => setCxForm(null),
          onRoots: loadConnecteurs,
        }) : null,
        importOpen === true ? h(ImportModal, {
          roots: roots,
          existing: cx.map((c) => c.nom),
          onRoots: loadConnecteurs,
          onChanged: (noms) => { touch(noms); loadConnecteurs() },
          onDone: (n, noms) => savedServers(noms, kbt('kb.cp.imp.done').replace('{n}', String(n))),
          onClose: () => setImportOpen(false),
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
      composio: { cloudView: kbCpCloudView, cloudMerge: kbCpCloudMerge, cloudErr: kbCpCloudErr, connState: kbCpConnState, connActions: kbCpConnActions, failedText: kbCpFailedText, appsMatch: kbCpAppsMatch, modeGet: kbCpModeGet, modeSet: kbCpModeSet, page: ComposioPage, hostIsOld: kbCpHostIsOld, getLink: kbCpGetLink, saveLink: kbCpSaveLink, event: 'kbcp-key', webUrl: kbCpWebUrl, carteHtml: carteHtml, carteAccepter: carteAccepter, carteAcceptMax: CARTE_ACCEPT_MAX, match: kbCpMatch, joinArgs: kbCpJoinArgs, t: kbt, errText: kbCpErrText, keyState: kbCpKeyState, testErr: kbCpTestErr, statusOf: kbCpStatusOf, importParse: kbCpImportParse, importBody: kbCpImportBody, safeName: kbCpSafeName, targetOf: kbCpTargetOf, formOf: kbCpFormOf, bodyOf: kbCpBodyOf },
    }
  },
})
