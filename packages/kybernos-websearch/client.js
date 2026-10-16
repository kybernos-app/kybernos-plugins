// ═══════════════════════════════════════════════════════════════════════════
// kybernos-websearch: browser half.
//
// One Settings page, « Web Search »: the engines the agents' web_search goes through, in order, with a switch, a key
// or an address where one is needed, a test button, and the sites to allow or block. Everything is read from and
// written to /kybernos-websearch/* (the host half); a key is typed here and never shown again.
// ═══════════════════════════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-websearch',
  factory (require) {
    try {
      const React = require('react')
      const h = React.createElement

      const lang = () => {
        try {
          const l = window.__KB_LANG_RESOLVE__ && window.__KB_LANG_RESOLVE__()
          const s = String(l || '')
          return (s === 'kybernos' || s.split(/[-_]/)[0] === 'fr') ? 'fr' : 'en'
        } catch (e) { return 'en' }
      }
      const kt = (fr, en) => (lang() === 'fr' ? fr : en)

      // the name (one word for every language, or { fr, en }) and a one-line description, French and English.
      const META = {
        searxng: { name: 'SearXNG', fr: 'Ta propre instance SearXNG : privé, sans clé, sans limite.', en: 'Your own SearXNG instance: private, no key, no limit.' },
        custom: { name: { fr: 'Adresse personnalisée', en: 'Custom address' }, fr: 'Un service de recherche à toi (contrat « external » d’OpenWebUI : POST {query, count}).', en: 'A search service of your own (OpenWebUI’s “external” contract: POST {query, count}).' },
        'brave-api': { name: 'Brave Search API', fr: 'Index indépendant, résultats propres.', en: 'Independent index, clean results.' },
        tavily: { name: 'Tavily', fr: 'Moteur pensé pour les agents.', en: 'A search engine built for agents.' },
        serper: { name: 'Serper', fr: 'Résultats Google.', en: 'Google results.' },
        exa: { name: 'Exa', fr: 'Recherche sémantique, extraits du contenu.', en: 'Semantic search with page excerpts.' },
        kagi: { name: 'Kagi', fr: 'Moteur payant sans publicité.', en: 'Paid, ad-free search.' },
        'google-pse': { name: 'Google Programmable Search', fr: 'Google, limité aux sites que tu choisis.', en: 'Google, limited to the sites you choose.' },
        jina: { name: 'Jina Search', fr: 'Recherche avec contenu des pages.', en: 'Search with page content.' },
        perplexity: { name: 'Perplexity Search', fr: 'API de recherche de Perplexity.', en: 'Perplexity’s search API.' },
        deepseek: { name: { fr: 'Recherche native DeepSeek', en: 'DeepSeek native search' }, fr: 'Le moteur d’origine de DSH : un tour de modèle par recherche.', en: 'DSH’s own default: one model turn per search.' },
        'brave-web': { name: 'Brave Search', fr: 'La page de résultats de Brave, sans clé. Peut demander un captcha.', en: 'Brave’s results page, no key. May ask for a captcha.' },
        'exa-free': { name: 'Exa', fr: 'Quota gratuit d’Exa, sans clé.', en: 'Exa’s free quota, no key.' },
        duckduckgo: { name: 'DuckDuckGo', fr: 'Sans clé. Se ferme parfois à un client qu’il prend pour un robot.', en: 'No key. Sometimes closes to a client it takes for a bot.' },
        wikipedia: { name: 'Wikipedia', fr: 'Une encyclopédie, pas le web : à n’activer qu’en dernier recours.', en: 'An encyclopedia, not the web: switch it on only as a last resort.' }
      }
      const nameOf = (id) => {
        const n = META[id] ? META[id].name : id
        return typeof n === 'object' ? kt(n.fr, n.en) : n
      }
      const descOf = (id) => (META[id] ? kt(META[id].fr, META[id].en) : '')
      const KIND_TXT = {
        auth: ['clé refusée', 'key refused'], quota: ['limite atteinte', 'rate limited'], blocked: ['défi anti-robot', 'asked for a challenge'],
        server: ['erreur du service', 'service error'], network: ['injoignable', 'unreachable'], timeout: ['trop lent', 'too slow'],
        parse: ['réponse illisible', 'unreadable answer'], config: ['mal configuré', 'not set up correctly'], missing: ['clé ou adresse manquante', 'key or address missing'],
        empty: ['aucun résultat', 'nothing found']
      }
      const kindTxt = (k) => { const t = KIND_TXT[k] || [String(k || ''), String(k || '')]; return kt(t[0], t[1]) }
      const hhmm = (ts) => { try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch (e) { return '' } }
      const secs = (ms) => (ms === null || ms === undefined ? '' : (ms / 1000).toFixed(1).replace('.', kt(',', '.')) + ' s')

      const api = (path, body) => fetch(path, body === undefined
        ? { headers: { Accept: 'application/json' } }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then((r) => (r.status === 404 ? Promise.reject(new Error(kt('Le serveur DSH n’a pas encore chargé cette version : redémarre-le.', 'The DSH server has not loaded this version yet: restart it.'))) : r.json()))

      // The address rule of the host (settings.mjs drops a value it does not accept without a word); said here before saving.
      const httpUrlOk = (text) => {
        try { const u = new URL(text); return text.length <= 2048 && (u.protocol === 'http:' || u.protocol === 'https:') && u.username === '' && u.password === '' && u.hostname !== '' } catch (e) { return false }
      }
      /** The sentence that says why `text` cannot be saved in the field `key`, or null (a blank clears the field: allowed). */
      const addressProblem = (key, text) => {
        const t = String(text === undefined || text === null ? '' : text).trim()
        if (t === '') return null
        if (key === 'searxngUrl' || key === 'customUrl') return httpUrlOk(t) ? null : kt('Saisis une adresse http(s), par exemple http://127.0.0.1:8080.', 'Enter an http(s) address such as http://127.0.0.1:8080.')
        if (key === 'googleCx') return /^[A-Za-z0-9:_-]{1,100}$/.test(t) ? null : kt('Lettres, chiffres, « : », « _ » et « - » seulement.', 'Letters, digits, “:”, “_” and “-” only.')
        if (key === 'wikiLang') return /^[a-z]{2,3}(-[a-z]+)?$/.test(t) ? null : kt('Un code de langue, par exemple en ou fr.', 'A language code, such as en or fr.')
        return null
      }
      // What a failed connection ran into, in words (the host sends a code, router.mjs networkReason).
      const REASON_TXT = {
        refused: ['Rien n’écoute à cette adresse (connexion refusée).', 'Nothing is listening at this address (connection refused).'],
        notfound: ['Ce nom d’hôte est introuvable.', 'This host name could not be found.'],
        reset: ['La connexion a été coupée par l’autre côté.', 'The connection was cut by the other side.'],
        tls: ['Le certificat de ce serveur n’est pas accepté.', 'This server’s certificate is not accepted.'],
        badport: ['Ce port est interdit pour une requête web : choisis-en un autre.', 'This port is not allowed for a web request: pick another one.']
      }
      /** What follows the kind of a failed test: the sentence for its reason, never the raw « fetch failed ». */
      const testDetail = (test) => {
        if (test === null || test === undefined || test.kind === 'missing' || test.kind === 'empty') return ''
        if (test.kind === 'network') {
          const r = REASON_TXT[test.reason]
          if (r !== undefined) return kt(r[0], r[1])
          if (test.message === undefined || test.message === '' || test.message === 'fetch failed') return kt('Rien n’a répondu à cette adresse.', 'Nothing answered at this address.')
        }
        return test.message || ''
      }
      /** The default engine: the first one of the list that is switched on and can answer (a key or an address is there). It is the
       *  one agents try first; the next ones only take over when it fails. null when none is. */
      const defaultEngine = (engines) => {
        const e = (Array.isArray(engines) ? engines : []).find((x) => x !== null && typeof x === 'object' && x.enabled === true && x.configured === true)
        return e === undefined ? null : e
      }
      const accessBadge = (e) => (e.access === 'free'
        ? { cls: 'free', txt: kt('SANS CLÉ', 'NO KEY') }
        : (e.access === 'key' ? { cls: 'key', txt: kt('CLÉ', 'KEY') } : { cls: 'url', txt: kt('ADRESSE', 'ADDRESS') }))

      const statusOf = (e) => {
        const hl = e.health || {}
        if (!e.enabled) return { cls: 'off', txt: kt('Désactivé', 'Switched off') }
        if (!e.configured) return { cls: 'warn', txt: e.access === 'key' ? kt('Clé manquante', 'Key missing') : kt('Adresse manquante', 'Address missing') }
        if (hl.pausedUntil) return { cls: 'down', txt: kt('En pause · ', 'Paused · ') + kindTxt(hl.kind) + kt(' · réessai à ', ' · retry at ') + hhmm(hl.pausedUntil) }
        if (hl.lastOkAt) return { cls: 'ok', txt: kt('A répondu à ', 'Answered at ') + hhmm(hl.lastOkAt) + (hl.lastCount !== null && hl.lastCount !== undefined ? ' · ' + hl.lastCount + kt(' résultats', ' results') : '') + (hl.lastMs !== null && hl.lastMs !== undefined ? ' · ' + secs(hl.lastMs) : '') }
        // An address is only a string until something answered at it: do not call it ready (A3-26).
        if (e.access === 'url') return { cls: 'idle', txt: kt('Adresse enregistrée · pas encore testée', 'Address saved · not tested yet') }
        return { cls: 'ok', txt: kt('Prêt', 'Ready') }
      }

      const Row = (props) => {
        const e = props.engine
        const open = props.open === true
        const [value, setValue] = React.useState('')
        const [addr, setAddr] = React.useState(null)
        const [test, setTest] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const s = props.settings
        const badge = accessBadge(e)
        const st = statusOf(e)
        const addrKey = ['searxngUrl', 'customUrl', 'googleCx', 'wikiLang'].indexOf(e.field) !== -1 ? e.field : null
        const addrValue = addr !== null ? addr : (addrKey ? (s[addrKey] || '') : '')
        const addrBad = addr !== null && addrKey !== null ? addressProblem(addrKey, addr) : null
        const secretRef = e.refs.length > 0 ? e.refs[0] : null

        const runTest = () => {
          setBusy(true)
          setTest(null)
          api('/kybernos-websearch/test', { id: e.id })
            .then((j) => { setBusy(false); if (j && j.ok === true) { setTest(j.result); props.onState(j.state) } else setTest({ ok: false, message: String((j && j.error) || 'Rejected.') }) })
            .catch((err) => { setBusy(false); setTest({ ok: false, message: String((err && err.message) || err) }) })
        }
        const saveKey = () => {
          if (secretRef === null || value.trim() === '') return
          api('/kybernos-websearch/key', { ref: secretRef.ref, value: value.trim() })
            .then((j) => { if (j && j.ok === true) { setValue(''); props.onState(j); props.onMsg('') } else props.onMsg(j && j.error === 'invalid-key' ? kt('Cette clé n’a pas la bonne forme.', 'That key does not look right.') : String((j && j.error) || 'Rejected.')) })
            .catch((err) => props.onMsg(String((err && err.message) || err)))
        }
        const clearKey = () => {
          if (secretRef === null) return
          api('/kybernos-websearch/key', { ref: secretRef.ref, clear: true })
            .then((j) => { if (j && j.ok === true) props.onState(j) })
            .catch((err) => props.onMsg(String((err && err.message) || err)))
        }
        const saveAddr = () => {
          if (addrKey === null || addr === null || addrBad !== null) return
          props.onPatch({ [addrKey]: addr.trim() })
          setAddr(null)
        }

        const detail = open
          ? h('div', { className: 'kwse-detail', 'data-kb': 'websearch-detail' },
            descOf(e.id) !== '' ? h('p', { className: 'kwse-desc' }, descOf(e.id)) : null,
            addrKey !== null
              ? h('div', { className: 'kwse-field' },
                h('label', null, addrKey === 'googleCx' ? kt('Identifiant du moteur (cx)', 'Search engine id (cx)') : (addrKey === 'wikiLang' ? kt('Langue de l’encyclopédie (code)', 'Encyclopedia language (code)') : kt('Adresse', 'Address'))),
                h('input', {
                  className: 'kwse-in', 'data-kb': 'websearch-url', type: 'text', spellCheck: false, autoComplete: 'off',
                  placeholder: addrKey === 'searxngUrl' ? 'http://127.0.0.1:8080' : (addrKey === 'customUrl' ? 'https://search.example.com/query' : (addrKey === 'wikiLang' ? 'en' : 'a1b2c3d4e5')),
                  value: addrValue, onChange: (ev) => setAddr(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') saveAddr() }
                }),
                h('button', { type: 'button', className: 'kwse-btn', 'data-act': 'save-address', disabled: addr === null || addrBad !== null, onClick: saveAddr }, kt('Enregistrer', 'Save')),
                addrBad !== null ? h('p', { className: 'kwse-err kwse-addr-err', role: 'alert', 'data-kb': 'websearch-address-error' }, addrBad) : null)
              : null,
            secretRef !== null
              ? h('div', { className: 'kwse-field' },
                h('label', null, secretRef.optional ? kt('Clé (facultative)', 'Key (optional)') : kt('Clé d’API', 'API key')),
                secretRef.configured
                  ? h('span', { className: 'kwse-has', 'data-kb': 'websearch-key-set' }, '✓ ' + kt('Enregistrée', 'Stored') + (secretRef.source === 'env' || secretRef.source === 'user-env' || secretRef.source === 'project-env' ? kt(' (variable d’environnement)', ' (environment variable)') : ''))
                  : null,
                h('input', {
                  className: 'kwse-in', 'data-kb': 'websearch-key-input', type: 'password', spellCheck: false, autoComplete: 'off',
                  placeholder: secretRef.configured ? kt('Remplacer la clé…', 'Replace the key…') : secretRef.ref, value,
                  onChange: (ev) => setValue(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') saveKey() }
                }),
                h('button', { type: 'button', className: 'kwse-btn', 'data-act': 'save-key', disabled: value.trim() === '', onClick: saveKey }, kt('Enregistrer', 'Save')),
                secretRef.configured && secretRef.source === 'file'
                  ? h('button', { type: 'button', className: 'kwse-link', 'data-act': 'clear-key', onClick: clearKey }, kt('Retirer', 'Remove'))
                  : null)
              : null,
            h('div', { className: 'kwse-field' },
              h('button', { type: 'button', className: 'kwse-btn', 'data-act': 'test', disabled: busy || !e.configured, onClick: runTest }, busy ? kt('Test…', 'Testing…') : kt('Tester', 'Test')),
              e.home ? h('a', { className: 'kwse-link', href: e.home, target: '_blank', rel: 'noopener noreferrer' }, kt('Obtenir une clé', 'Get a key')) : null,
              test !== null
                ? h('span', { className: 'kwse-test ' + (test.ok ? 'ok' : 'ko'), 'data-kb': 'websearch-test-result' },
                  test.ok
                    ? '✓ ' + test.count + kt(' résultats · ', ' results · ') + secs(test.ms) + (test.sample && test.sample[0] ? ' · ' + (test.sample[0].title || test.sample[0].url) : '')
                    : '✗ ' + kindTxt(test.kind) + (testDetail(test) !== '' ? ' — ' + testDetail(test) : ''))
                : null))
          : null

        return h('div', { className: 'kwse-row' + (e.enabled ? '' : ' off'), 'data-kb': 'websearch-engine', 'data-id': e.id },
          h('div', { className: 'kwse-row-main' },
            h('div', { className: 'kwse-move' },
              h('button', { type: 'button', 'data-act': 'up', disabled: props.first, 'aria-label': kt('Monter', 'Move up'), onClick: () => props.onMove(e.id, -1) }, '▲'),
              h('button', { type: 'button', 'data-act': 'down', disabled: props.last, 'aria-label': kt('Descendre', 'Move down'), onClick: () => props.onMove(e.id, 1) }, '▼')),
            h('button', { type: 'button', className: 'kwse-name', 'data-act': 'open', 'aria-expanded': String(open), onClick: () => props.onToggle(e.id) },
              h('b', null, nameOf(e.id)),
              h('span', { className: 'kwse-badge ' + badge.cls }, badge.txt),
              props.isDefault === true ? h('span', { className: 'kwse-badge def', 'data-kb': 'websearch-default', title: kt('Agents cherchent d’abord avec ce moteur ; le suivant prend le relais s’il échoue.', 'Agents search with this engine first; the next one takes over if it fails.') }, kt('PAR DÉFAUT', 'DEFAULT')) : null,
              h('small', { className: 'kwse-status ' + st.cls }, h('i', { className: 'kwse-dot ' + st.cls }), st.txt)),
            h('button', {
              type: 'button', className: 'kwse-switch' + (e.enabled ? ' on' : ''), 'data-kb': 'websearch-switch', role: 'switch',
              'aria-checked': String(e.enabled), 'aria-label': nameOf(e.id), onClick: () => props.onPatch({ enabled: { [e.id]: !e.enabled } })
            }, h('span', null))),
          detail)
      }

      // The page's head and its explanation: static text, so the skeleton draws the same (nothing moves when the engines arrive).
      const pageHead = () => h(React.Fragment, null,
        h('div', { className: 'kwse-head' },
          h('h4', null, kt('Recherche web', 'Web Search')),
          (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-websearch' }) : null)),
        h('p', { className: 'kwse-intro' }, kt(
          'Les agents cherchent sur le web avec le premier moteur de cette liste qui répond. Les moteurs « sans clé » marchent tout de suite ; ajoute une clé pour qu’un moteur à clé passe en premier. Un moteur qui échoue est mis en pause, le suivant prend le relais.',
          'Agents search the web with the first engine in this list that answers. “No key” engines work right away; add a key so a keyed engine goes first. An engine that fails is paused and the next one takes over.'))
      )

      const Page = () => {
        const [state, setState] = React.useState(null)
        const [msg, setMsg] = React.useState('')
        const [domains, setDomains] = React.useState(null)
        const [openId, setOpenId] = React.useState(null)
        const [showMore, setShowMore] = React.useState(false)
        const [seam, setSeam] = React.useState(null)
        const [seamBusy, setSeamBusy] = React.useState(false)
        const read = () => api('/kybernos-websearch/state').then((j) => { if (j && j.ok === true) setState(j) }).catch((err) => setMsg(String((err && err.message) || err)))
        React.useEffect(() => {
          read()
          const t = setInterval(read, 20000)
          return () => clearInterval(t)
        }, [])
        if (state === null) {
          if (msg !== '') return h('div', { className: 'kwse-page', 'data-kb': 'websearch-page' }, h('p', { className: 'kwse-err' }, msg))
          // First read: bones in the engine rows' own box (the shared skeleton helper of the core plugin, window.__KB_SKEL__);
          // a bare « … » without it, as before.
          let k = null
          try { k = window.__KB_SKEL__ } catch (e) { k = null }
          if (k === null || k === undefined || typeof k.bone !== 'function' || typeof k.wrap !== 'function') return h('div', { className: 'kwse-page', 'data-kb': 'websearch-page' }, '…')
          return h('div', { className: 'kwse-page', 'data-kb': 'websearch-page' },
            pageHead(),
            k.wrap(kt('Chargement…', 'Loading…'), 'kwse-list', [0, 1, 2, 3].map((i) => h('div', { key: 'sk' + i, className: 'kwse-row kb-sk-row' },
              h('div', { className: 'kwse-row-main' },
                k.bone(22, 40, null, 6),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 } }, k.bone(i % 2 === 0 ? 110 : 84, 14), k.bone(58, 18, 'pill'), k.bone(70, 11)),
                k.bone(36, 20, 'pill'))))))
        }

        const patch = (p) => api('/kybernos-websearch/settings', p)
          .then((j) => { if (j && j.ok === true) { setState(j); setMsg('') } else setMsg(String((j && j.error) || 'Rejected.')) })
          .catch((err) => setMsg(String((err && err.message) || err)))
        // The list the person reads is the CHAIN: the engines that can answer, in the order they are tried. The ones that still
        // need a key or an address are folded below, so the page is three or four rows, not fifteen.
        const move = (id, dir) => {
          const usable = state.engines.filter((e) => e.configured).map((e) => e.id)
          const i = usable.indexOf(id)
          const neighbour = usable[i + dir]
          if (i < 0 || neighbour === undefined) return
          const order = state.engines.map((e) => e.id)
          const a = order.indexOf(id)
          const b = order.indexOf(neighbour)
          order[a] = neighbour
          order[b] = id
          patch({ order })
        }
        const runSeam = () => {
          setSeamBusy(true)
          setSeam(null)
          api('/kybernos-websearch/seam', {})
            .then((j) => { setSeamBusy(false); if (j && j.ok === true) { setSeam(j.result); setState(j.state) } else setSeam({ ok: false, message: String((j && j.error) || 'Rejected.') }) })
            .catch((err) => { setSeamBusy(false); setSeam({ ok: false, message: String((err && err.message) || err) }) })
        }
        const saveDomains = () => { if (domains !== null) { patch({ domains }); setDomains(null) } }
        const s = state.settings
        const used = state.engines.filter((e) => e.configured)
        const more = state.engines.filter((e) => !e.configured)
        const defaultId = defaultEngine(state.engines) === null ? null : defaultEngine(state.engines).id
        const toggle = (id) => setOpenId(openId === id ? null : id)
        const rowOf = (e, i, list, fixed) => h(Row, {
          key: e.id, engine: e, settings: s, open: openId === e.id, onToggle: toggle, isDefault: fixed !== true && defaultId === e.id,
          first: fixed || i === 0, last: fixed || i === list.length - 1, onMove: move, onPatch: patch, onState: setState, onMsg: setMsg
        })
        const wrongPin = state.pinned !== null && state.pinned !== state.provider
        const last = state.last

        return h('div', { className: 'kwse-page', 'data-kb': 'websearch-page' },
          pageHead(),
          h('p', { className: 'kwse-default', 'data-kb': 'websearch-default-line' }, defaultId === null
            ? kt('Aucun moteur n’est activé : les agents ne peuvent pas chercher sur le web.', 'No engine is switched on: agents cannot search the web.')
            : kt('Moteur par défaut : ', 'Default engine: ') + nameOf(defaultId) + kt(' — les agents l’essaient en premier.', ' — agents try it first.')),
          wrongPin
            ? h('p', { className: 'kwse-banner', 'data-kb': 'websearch-banner' }, kt(
              'DSH est réglé sur un autre fournisseur (« ' + state.pinned + ' ») : cette liste n’est pas utilisée tant que la ligne « web » du profil n’est pas revenue à « ' + state.provider + ' ».',
              'DSH is set to another provider (“' + state.pinned + '”): this list is not used until the profile’s “web” row is back to “' + state.provider + '”.'))
            : null,
          state.registered !== true
            ? h('p', { className: 'kwse-banner', 'data-kb': 'websearch-banner' }, kt('Le fournisseur n’est pas enregistré auprès de DSH : redémarre DSH pour l’activer.', 'The provider is not registered with DSH: restart DSH to activate it.'))
            : null,
          h('div', { className: 'kwse-list', 'data-kb': 'websearch-list' }, used.map((e, i) => rowOf(e, i, used, false))),
          more.length > 0
            ? h('div', { className: 'kwse-more' },
              h('button', { type: 'button', className: 'kwse-link', 'data-act': 'more', 'aria-expanded': String(showMore), onClick: () => setShowMore(!showMore) },
                (showMore ? '▾ ' : '▸ ') + kt('Autres moteurs (' + more.length + ') : ajoute une clé ou une adresse', 'More engines (' + more.length + '): add a key or an address')),
              showMore ? h('div', { className: 'kwse-list', 'data-kb': 'websearch-more' }, more.map((e, i) => rowOf(e, i, more, true))) : null)
            : null,
          h('div', { className: 'kwse-block' },
            h('b', null, kt('Sites', 'Sites')),
            h('span', null, kt('Un par ligne ou séparés par des virgules. « exemple.com » ne garde que ce site ; « !exemple.com » l’exclut.', 'One per line or comma separated. “example.com” keeps only that site; “!example.com” excludes it.')),
            h('textarea', {
              className: 'kwse-area', 'data-kb': 'websearch-domains', rows: 3, spellCheck: false, placeholder: 'docs.rs, !pinterest.com',
              value: domains !== null ? domains : (s.domains || ''), onChange: (ev) => setDomains(ev.target.value), onBlur: saveDomains
            })),
          h('div', { className: 'kwse-block' },
            h('b', null, kt('Mémoire et délai', 'Cache and timeout')),
            h('div', { className: 'kwse-inline' },
              h('label', null, kt('Garder une réponse (minutes)', 'Keep an answer (minutes)'),
                h('input', { className: 'kwse-num', type: 'number', min: 0, max: 60, value: s.cacheMinutes, 'data-kb': 'websearch-cache', onChange: (ev) => patch({ cacheMinutes: Number(ev.target.value) }) })),
              h('label', null, kt('Délai par moteur (secondes)', 'Timeout per engine (seconds)'),
                h('input', { className: 'kwse-num', type: 'number', min: 3, max: 60, value: s.timeoutS, 'data-kb': 'websearch-timeout', onChange: (ev) => patch({ timeoutS: Number(ev.target.value) }) })))),
          h('p', { className: 'kwse-last', 'data-kb': 'websearch-last' }, last === null || last === undefined
            ? kt('Aucune recherche depuis le démarrage.', 'No search since DSH started.')
            : (last.engine !== null
              ? kt('Dernière recherche : ', 'Last search: ') + nameOf(last.engine) + ' · ' + last.count + kt(' résultats · ', ' results · ') + secs(last.ms) + ' · ' + hhmm(last.at)
              : kt('Dernière recherche : aucun moteur n’a répondu (', 'Last search: no engine answered (') + last.trace.map((t) => nameOf(t.id) + ' ' + kindTxt(t.result)).join(', ') + ') · ' + hhmm(last.at))),
          h('div', { className: 'kwse-field kwse-seam' },
            h('button', { type: 'button', className: 'kwse-btn', 'data-act': 'seam-test', disabled: seamBusy, onClick: runSeam }, seamBusy ? kt('Recherche…', 'Searching…') : kt('Chercher comme un agent', 'Search the way an agent does')),
            seam !== null
              ? h('span', { className: 'kwse-test ' + (seam.ok ? 'ok' : 'ko'), 'data-kb': 'websearch-seam-result' },
                seam.ok
                  ? '✓ ' + seam.count + kt(' résultats via ', ' results via ') + (seam.engine ? nameOf(seam.engine) : '?') + ' · ' + secs(seam.ms)
                  : '✗ ' + (seam.code ? seam.code + ' — ' : '') + String(seam.message || '').split('\n')[0])
              : null),
          msg !== '' ? h('p', { className: 'kwse-err' }, msg) : null)
      }

      const CSS = [
        '.kwse-page{max-width:720px;font-size:14px;line-height:normal}',
        '.kwse-head{display:flex;align-items:center;gap:10px}',
        '.kwse-page h4{margin:0 0 2px;font-size:26px;font-weight:800;letter-spacing:-.01em;line-height:1.25}',
        '.kwse-intro{margin:0 0 14px;color:var(--dsw-alias-label-secondary,#666);font-size:13px;line-height:1.45}',
        '.kwse-banner{margin:0 0 12px;padding:9px 12px;border-radius:10px;font-size:12.5px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#c80) 16%,transparent);color:var(--dsw-alias-label-primary,inherit)}',
        '.kwse-list{border:0.5px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px;background:var(--dsw-alias-bg-layer-1,transparent);overflow:hidden}',
        '.kwse-row{border-bottom:0.5px solid var(--dsw-alias-border-l2,#ddd)}',
        '.kwse-row:last-child{border-bottom:0}',
        '.kwse-row.off .kwse-name b{color:var(--dsw-alias-label-tertiary,#888)}',
        '.kwse-row-main{display:flex;align-items:center;gap:10px;padding:10px 12px}',
        '.kwse-move{display:flex;flex-direction:column;gap:1px;flex:none}',
        '.kwse-move button{border:0;background:none;padding:0 4px;font-size:9px;line-height:11px;cursor:pointer;color:var(--dsw-alias-label-tertiary,#888)}',
        '.kwse-move button:hover:not(:disabled){color:var(--dsw-alias-label-primary,inherit)}',
        '.kwse-move button:disabled{opacity:.3;cursor:default}',
        '.kwse-name{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;text-align:start;border:0;background:none;padding:0;cursor:pointer;font:inherit;color:inherit}',
        '.kwse-name b{font-size:14px;font-weight:500;color:var(--dsw-alias-label-primary,inherit)}',
        '.kwse-badge{font-size:9.5px;font-weight:600;letter-spacing:.05em;padding:1px 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-3,#eee);color:var(--dsw-alias-label-secondary,#555)}',
        '.kwse-badge.free{color:var(--dsw-alias-state-success-primary,#0a7)}',
        '.kwse-badge.def{color:var(--dsw-alias-brand-primary,#36c);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#36c) 14%,transparent)}',
        '.kwse-default{margin:0 0 10px;font-size:12.5px;color:var(--dsw-alias-label-secondary,#555)}',
        '.kwse-badge.key{color:var(--dsw-alias-state-warn-primary,#a60)}',
        // Light scheme: the state tokens are fills (green 2.3:1, amber 2.2:1 on white); the ink is mixed toward the text colour.
        'body:not([data-ds-dark-theme]) .kwse-badge.free{color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-label-primary))}body:not([data-ds-dark-theme]) .kwse-badge.key{color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 50%,var(--dsw-alias-label-primary))}',
        '.kwse-status{flex-basis:100%;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-tertiary,#888)}',
        '.kwse-dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-border-l3,#bbb)}',
        '.kwse-dot.ok{background:var(--dsw-alias-state-success-primary,#0a7)}',
        '.kwse-dot.warn{background:var(--dsw-alias-state-warn-primary,#c80)}',
        '.kwse-dot.down{background:var(--dsw-alias-state-error-primary,#c33)}',
        '.kwse-switch{width:34px;height:20px;border:0;border-radius:999px;cursor:pointer;position:relative;flex:none;background:var(--dsw-alias-border-l3,#bbb)}',
        '.kwse-switch.on{background:var(--dsw-alias-brand-primary,#36c)}',
        '.kwse-switch span{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground,#fff);transition:left 120ms ease}',
        '.kwse-switch.on span{left:16px}',
        '.kwse-detail{padding:2px 12px 12px 36px;display:flex;flex-direction:column;gap:8px}',
        '.kwse-desc{margin:0;font-size:12.5px;color:var(--dsw-alias-label-secondary,#666)}',
        '.kwse-field{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
        '.kwse-field label{flex-basis:100%;font-size:12px;color:var(--dsw-alias-label-tertiary,#888)}',
        '.kwse-in{flex:1;min-width:180px;height:30px;padding:0 10px;font:500 12.5px ui-monospace,Menlo,monospace;color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-layer-1,transparent);border:0.5px solid var(--dsw-alias-border-l2,#ddd);border-radius:8px}',
        '.kwse-btn{height:30px;padding:0 12px;border:0;border-radius:8px;cursor:pointer;font:inherit;font-size:12.5px;font-weight:600;background:var(--dsw-alias-button-primary-fill,#36c);color:var(--dsw-alias-label-primary-foreground,#fff)}',
        '.kwse-btn:disabled{opacity:.5;cursor:default}',
        '.kwse-link{border:0;background:none;padding:0;cursor:pointer;font:inherit;font-size:12.5px;color:var(--dsw-alias-brand-primary,#36c);text-decoration:none}',
        '.kwse-has{font-size:12px;color:var(--dsw-alias-state-success-primary,#0a7)}',
        '.kwse-test{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}',
        '.kwse-test.ok{color:var(--dsw-alias-state-success-primary,#0a7)}',
        '.kwse-test.ko{color:var(--dsw-alias-state-error-primary,#c33)}',
        '.kwse-block{display:flex;flex-direction:column;gap:6px;margin-top:18px}',
        '.kwse-block b{font-size:14px;font-weight:600}',
        '.kwse-block span{font-size:12.5px;color:var(--dsw-alias-label-tertiary,#888)}',
        '.kwse-area{width:100%;box-sizing:border-box;padding:8px 10px;font:500 12.5px ui-monospace,Menlo,monospace;color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-layer-1,transparent);border:0.5px solid var(--dsw-alias-border-l2,#ddd);border-radius:10px;resize:vertical}',
        // the browser's default placeholder is a mid grey: 3.4:1 on the dark layer
        '.kwse-area::placeholder{color:var(--dsw-alias-label-secondary,inherit)}',
        '.kwse-inline{display:flex;flex-wrap:wrap;gap:18px}',
        '.kwse-inline label{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--dsw-alias-label-secondary,#666)}',
        '.kwse-num{width:64px;height:30px;padding:0 8px;font:inherit;color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-layer-1,transparent);border:0.5px solid var(--dsw-alias-border-l2,#ddd);border-radius:8px}',
        '.kwse-seam{margin-top:12px}',
        '.kwse-more{margin-top:10px;display:flex;flex-direction:column;gap:8px;align-items:flex-start}',
        '.kwse-more .kwse-list{align-self:stretch}',
        '.kwse-last{margin:16px 0 0;font-size:12px;color:var(--dsw-alias-label-tertiary,#888)}',
        '.kwse-err{margin:10px 0 0;font-size:12px;color:var(--dsw-alias-state-error-primary,#c33)}',
        '@media (max-width:640px){.kwse-detail{padding-left:12px}.kwse-in{min-width:0}}'
      ].join('\n')

      return {
        name: 'kybernos-websearch',
        inject: ['slots'],
        apply (ctx) {
          const slots = ctx.slots
          if (slots === undefined || slots === null) return
          let tag = null
          try {
            tag = document.createElement('style')
            tag.dataset.plugin = '@local/kybernos-websearch'
            tag.textContent = CSS
            document.head.append(tag)
          } catch (e) { /* no DOM */ }
          try {
            ctx.effect(() => {
              const off = slots.inject('settings.section', () => slots.register(
                { name: 'settings.section', id: 'kybernos-websearch-page', order: 15, label: kt('Recherche web', 'Web Search') },
                () => h(Page)))
              return () => { try { off() } catch (e) { /* gone */ } try { if (tag !== null) tag.remove() } catch (e) { /* gone */ } }
            }, 'kybernos-websearch: settings page')
          } catch (e) { console.warn('[kybernos-websearch] page not mounted', e) }
        },
        __test: { statusOf, accessBadge, nameOf, addressProblem, testDetail, defaultEngine }
      }
    } catch (e) {
      console.warn('[kybernos-websearch] disabled:', e)
      return { apply () {} }
    }
  }
})
