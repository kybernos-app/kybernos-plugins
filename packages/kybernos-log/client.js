// kybernos-log — browser half: the Settings page behind "Activity log" (System group).
//
// One question, one page: what did this machine send out, and what did it cost? The host follows every session
// event (`session/event`), keeps METADATA ONLY (never a message body, never a tool argument) and serves it from
// `/kybernos-log/events` and `/kybernos-log/stats`; `/kybernos-log/terminal` serves what DSH prints in its terminal, masked.
//
// Two tabs. Calls: four cards for today (with an hourly sparkline each), one toolbar line, family chips, and the rows,
// newest first, grouped by day, paged. Terminal: the two files DSH writes its terminal to, read from their end.
// Everything is read-only; nothing here can send anything.
//
// Where the rows are made (decided 2026-11-09): ON THE CLIENT. The host never serves more than its ring (MAX_RING, 4000
// records, about 0.8 MB of JSON), so the page reads the whole ring once (8 pages of 500 at most) and then only what is new.
// One pure function (`listing`) merges a tool call with its result and a turn's start with its end, collapses repeated
// failures, filters, and the page, the pager, the chips, the day headers and the "Errors only" count are all read from that
// same list: one number everywhere, and it works with a host that has not been restarted yet.
//
// No engine patch. Loaded through window.__ModuleLoader__.load; the factory RETURNS a plugin object and, on any
// error, a disabled one, so the GUI is preserved.
window.__ModuleLoader__.load({
  id: '@local/kybernos-log',
  factory (require) {
    try {
      const React = require('react')
      const h = React.createElement
      const useState = React.useState
      const useEffect = React.useEffect
      const useRef = typeof React.useRef === 'function' ? React.useRef : (v) => ({ current: v })
      const useMemo = typeof React.useMemo === 'function' ? React.useMemo : (f) => f()

      // -- language: French is the source, English the pair ----------------------------------------------------------
      const lang = () => {
        try { return String(typeof window.__KB_LANG_RESOLVE__ === 'function' ? window.__KB_LANG_RESOLVE__() : (document.documentElement.lang || 'en')) } catch (e) { return 'en' }
      }
      const kt = (fr, en) => {
        const l = lang()
        if (l === 'kybernos' || l.slice(0, 2) === 'fr') return fr
        return en
      }
      const fill = (text, p) => (p === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? String(p[k]) : m)))

      // [fr, en] pairs in one table: a test can check both sides of every pair.
      const S = {
        title: ['Journal d’activité', 'Activity log'],
        lead: ['Tout ce que cette machine envoie : appels modèle, connecteurs, recherche web, outils — et les appels que personne n’a demandés (titres, compactages, sondes).',
          'Everything this machine sends out: model calls, connectors, web search, tools — and the calls nobody asked for (titles, compactions, probes).'],
        privacy: ['Métadonnées seulement : le titre de chaque session est gardé, mais aucun texte de message ni argument d’outil.', 'Metadata only: the title of each session is kept, but no message text and no tool argument.'],
        tabCalls: ['Appels', 'Calls'],
        tabTerminal: ['Terminal', 'Terminal'],
        tabs: ['Vues du journal', 'Log views'],
        search: ['Rechercher un modèle, un outil, une conversation, une erreur…', 'Search model, tool, chat, error…'],
        period: ['Période', 'Period'],
        pToday: ['Aujourd’hui', 'Today'],
        pWeek: ['7 jours', '7 days'],
        pAll: ['Tout', 'All'],
        errorsOnly: ['Erreurs seulement', 'Errors only'],
        live: ['En direct', 'Live'],
        moreActions: ['Plus d’actions', 'More actions'],
        refresh: ['Rafraîchir', 'Refresh'],
        export: ['Copier en JSON', 'Copy JSON'],
        copied: ['Copié', 'Copied'],
        families: ['Familles', 'Families'],
        chipAll: ['Tout', 'All'],
        chipLlm: ['Modèle', 'Model'],
        chipTool: ['Outils', 'Tools'],
        chipConnector: ['Connecteurs', 'Connectors'],
        chipWeb: ['Recherche web', 'Web search'],
        chipTurn: ['Tours', 'Turns'],
        chipUnasked: ['Non demandés', 'Unasked'],
        chipApproval: ['Approbations', 'Approvals'],
        chipJob: ['Tâches', 'Jobs'],
        chipSandbox: ['Bac à sable', 'Sandbox'],
        cardCalls: ['Appels modèle aujourd’hui', 'Model calls today'],
        cardTokens: ['Tokens aujourd’hui', 'Tokens today'],
        cardFailures: ['Échecs aujourd’hui', 'Failures today'],
        cardFailuresHint: ['Montrer seulement les erreurs d’aujourd’hui', 'Show only today’s errors'],
        cardUnasked: ['Appels non demandés', 'Unasked calls'],
        perHour: ['Par heure, aujourd’hui', 'Per hour, today'],
        noHours: ['Pas encore de chiffres par heure : la route ne répond pas (hôte à relancer ?).', 'No hourly figures yet: the route does not answer (host to restart?).'],
        today: ['Aujourd’hui', 'Today'],
        yesterday: ['Hier', 'Yesterday'],
        dayTotal: ['{n} appels · {t} tokens', '{n} calls · {t} tokens'],
        dayTotalOne: ['1 appel · {t} tokens', '1 call · {t} tokens'],
        newCalls: ['{n} nouveaux appels · afficher', '{n} new calls · show'],
        newCall: ['1 nouvel appel · afficher', '1 new call · show'],
        pager: ['{a}–{b} sur {n} · les plus récents d’abord', '{a}–{b} of {n} · newest first'],
        perPage: ['{n} par page', '{n} per page'],
        perPageLabel: ['Lignes par page', 'Rows per page'],
        pages: ['Pages', 'Pages'],
        prev: ['Page précédente', 'Previous page'],
        next: ['Page suivante', 'Next page'],
        goPage: ['Aller à la page {n}', 'Go to page {n}'],
        rows: ['Appels', 'Calls'],
        nTurn: ['Tour', 'Turn'],
        nAutoTitle: ['Titre auto', 'Auto title'],
        nCompaction: ['Compactage', 'Compaction'],
        nApprovalAsked: ['Approbation demandée', 'Approval asked'],
        nApprovalDecided: ['Approbation décidée', 'Approval decided'],
        nSandbox: ['Mode bac à sable', 'Sandbox mode'],
        nJob: ['Tâche', 'Job'],
        nToolResult: ['Résultat d’outil', 'Tool result'],
        nProbe: ['Sonde', 'Probe'],
        inOut: ['{i} entrée · {o} sortie', '{i} in · {o} out'],
        cacheSub: ['{c} en cache', '{c} cached'],
        running: ['en cours', 'running'],
        completedIn: ['terminé en {d}', 'completed in {d}'],
        retryN: ['essai {n}', 'retry {n}'],
        pFailed: ['échec', 'failed'],
        pError: ['erreur', 'error'],
        pRetry: ['nouvel essai', 'retry'],
        dChat: ['Conversation', 'Chat'],
        openChat: ['ouvrir la conversation', 'open the chat'],
        dProvider: ['Fournisseur', 'Provider'],
        dModel: ['Modèle', 'Model'],
        dTokens: ['Tokens', 'Tokens'],
        dTokensVal: ['{i} en entrée · {o} en sortie · {c} en cache', '{i} in · {o} out · {c} cached'],
        dDuration: ['Durée', 'Duration'],
        dError: ['Erreur', 'Error'],
        dRepeats: ['Répétitions', 'Repeats'],
        dRepeatsVal: ['{n} fois : {times}', '{n} times: {times}'],
        dRepeatsChats: ['dans {n} conversations', 'in {n} chats'],
        dCallId: ['Identifiant d’appel', 'Call id'],
        dChatId: ['Identifiant de conversation', 'Chat id'],
        noChat: ['(aucune conversation)', '(no chat)'],
        nothingYet: ['Rien pour l’instant : le journal se remplit dès qu’un appel part.', 'Nothing yet: the log fills as soon as a call goes out.'],
        noMatch: ['Rien ne correspond à tes filtres.', 'Nothing matches your filters.'],
        clear: ['Effacer les filtres', 'Clear filters'],
        unreachable: ['La route du journal ne répond pas (hôte pas encore relancé ?).', 'The journal route does not answer (host not restarted yet?).'],
        tStream: ['Fichier', 'Stream'],
        tOut: ['Sortie', 'Output'],
        tErr: ['Erreurs', 'Errors'],
        tFilter: ['Filtrer les lignes…', 'Filter lines…'],
        tPlugins: ['Toutes les extensions', 'All plugins'],
        tPlugin: ['Extension', 'Plugin'],
        follow: ['Suivre', 'Follow'],
        copy: ['Copier', 'Copy'],
        tHead: ['Ce que DSH affiche dans son terminal · {n} lignes', 'What DSH prints in its terminal · {n} lines'],
        tOlder: ['Charger 500 lignes plus anciennes', 'Load 500 older lines'],
        tTruncated: ['Les lignes plus anciennes ne sont pas lues ici : seule la fin du fichier l’est.', 'Older lines are not read here: only the end of the file is.'],
        tStarted: ['DSH est prêt (les lignes au-dessus sont son démarrage)', 'DSH is ready (the lines above are its start)'],
        tFollowing: ['suivi en cours…', 'following…'],
        tEmpty: ['Aucune ligne ne correspond.', 'No line matches.'],
        tMissing: ['Pas encore de fichier {file} : DSH n’a rien écrit ici.', 'No {file} yet: DSH has written nothing here.'],
        tUnreachable: ['La route du terminal ne répond pas (hôte pas encore relancé ?).', 'The terminal route does not answer (host not restarted yet?).'],
        tSignin: ['Connecte-toi à nouveau pour lire le terminal.', 'Sign in again to read the terminal.'],
        tNote: ['Lu sur cet ordinateur seulement, jamais envoyé. Les tokens, clés et mots de passe sont masqués avant l’affichage ; une extension peut encore afficher un chemin de fichier ou un message d’erreur.', 'Read on this computer only, never sent. Tokens, keys and passwords are hidden before display; a plugin may still print a file path or an error message.'],
        famLlm: ['Modèle', 'Model'],
        famConnector: ['Connecteur', 'Connector'],
        famWebsearch: ['Recherche web', 'Web search'],
        famTool: ['Outil', 'Tool'],
        famTitle: ['Titre auto', 'Auto title'],
        famCompaction: ['Compactage', 'Compaction'],
        famProbe: ['Sonde', 'Probe'],
        famApproval: ['Approbation', 'Approval'],
        famJob: ['Tâche', 'Job'],
        famSandbox: ['Bac à sable', 'Sandbox'],
        famSession: ['Session', 'Session']
      }
      const L = (k, p) => fill(kt(S[k][0], S[k][1]), p)
      // True where the Suite's "?" card (window.__KB_HELP__.Help) does not exist: only then is the page's description drawn under its title (it lives in the card otherwise). Read at render time, never at load.
      const helpAbsent = () => { try { return !(typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help) } catch (e) { return true } }
      /** The page's head: its title and its "?" through the Suite's Title (one style for every page title, the button right after the text); the bare title where the Suite is not there. */
      const pageHead = (props) => { try { if (window.__KB_HELP__ && window.__KB_HELP__.Title) return h(window.__KB_HELP__.Title, props) } catch (e) { /* the bare title below */ } return h(props.as || 'h2', { className: 'kbhp-title' + (props.className ? ' ' + props.className : '') }, props.title, props.after) }

      const TYPES = ['llm', 'connector', 'websearch', 'tool', 'title', 'compaction', 'probe', 'approval', 'job', 'sandbox', 'session']
      const FAM = { llm: 'famLlm', connector: 'famConnector', websearch: 'famWebsearch', tool: 'famTool', title: 'famTitle', compaction: 'famCompaction', probe: 'famProbe', approval: 'famApproval', job: 'famJob', sandbox: 'famSandbox', session: 'famSession' }
      const fam = (t) => L(FAM[t] || 'famTool')

      // The chips: one per family a person filters on, in this order after "All". The calls nobody asked for (titles,
      // compactions, probes) are one chip, as they are one card.
      const CHIPS = [
        { key: 'llm', types: ['llm'], label: 'chipLlm', icon: 'llm' },
        { key: 'tool', types: ['tool'], label: 'chipTool', icon: 'tool' },
        { key: 'connector', types: ['connector'], label: 'chipConnector', icon: 'connector' },
        { key: 'websearch', types: ['websearch'], label: 'chipWeb', icon: 'websearch' },
        { key: 'session', types: ['session'], label: 'chipTurn', icon: 'session' },
        { key: 'unasked', types: ['title', 'compaction', 'probe'], label: 'chipUnasked', icon: 'unasked' },
        { key: 'approval', types: ['approval'], label: 'chipApproval', icon: 'approval' },
        { key: 'job', types: ['job'], label: 'chipJob', icon: 'job' },
        { key: 'sandbox', types: ['sandbox'], label: 'chipSandbox', icon: 'sandbox' }
      ]
      const chipOf = (type) => { for (const c of CHIPS) if (c.types.includes(type)) return c.key; return 'tool' }

      // Family marks: small monochrome stroke icons that take the text colour (currentColor), never a colour of their own.
      const ICONS = {
        llm: ['M8 1.5l1.6 4.2 4.4.3-3.4 2.8 1.1 4.3L8 10.7l-3.7 2.4 1.1-4.3L2 6l4.4-.3z'],
        tool: ['M2.5 4.5l3 3.5-3 3.5M7.5 12h6'],
        connector: ['M6 10l4-4M5 7.5L3.5 9a2.1 2.1 0 003 3L8 10.5M11 8.5L12.5 7a2.1 2.1 0 00-3-3L8 5.5'],
        websearch: [{ c: [8, 8, 5.5] }, 'M2.5 8h11M8 2.5c2 2.2 2 8.8 0 11M8 2.5c-2 2.2-2 8.8 0 11'],
        session: ['M13 8a5 5 0 11-1.5-3.6M13 2.5v2.5h-2.5'],
        unasked: [{ c: [8, 8, 5.5] }, 'M8 5v3.2l2 1.3'],
        approval: ['M8 1.8l5 2v4c0 3-2.2 5.2-5 6.4-2.8-1.2-5-3.4-5-6.4v-4z', 'M5.8 8.2l1.6 1.6 3-3.2'],
        job: ['M2.5 5L8 2.2 13.5 5v6L8 13.8 2.5 11z', 'M2.5 5L8 7.8 13.5 5M8 7.8v6'],
        sandbox: ['M3.5 6.5V4a.5.5 0 01.5-.5h2.5M9.5 3.5H12a.5.5 0 01.5.5v2.5M12.5 9.5V12a.5.5 0 01-.5.5H9.5M6.5 12.5H4a.5.5 0 01-.5-.5V9.5']
      }
      const icon = (key) => h('span', { className: 'kblg-ico', 'aria-hidden': 'true' },
        h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', focusable: 'false' },
          (ICONS[key] || ICONS.tool).map((d, i) => (typeof d === 'string' ? h('path', { key: i, d }) : h('circle', { key: i, cx: d.c[0], cy: d.c[1], r: d.c[2] })))))

      // -- numbers, times, days ------------------------------------------------------------------------------------
      const locale = () => kt('fr-FR', 'en-GB')
      const fmt = (n) => {
        const v = Number(n) || 0
        return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : String(v)
      }
      const count = (n) => { try { return Number(n || 0).toLocaleString(kt('fr-FR', 'en-US')) } catch (e) { return String(n || 0) } }
      const clock = (ms) => {
        try { return new Date(ms).toTimeString().slice(0, 8) } catch (e) { return '\u2014' }
      }
      const dur = (ms) => {
        const s = Math.max(0, Number(ms) || 0) / 1000
        if (s < 10) return (Math.round(s * 10) / 10).toFixed(1).replace(/\.0$/, '') + ' s'
        if (s < 60) return Math.round(s) + ' s'
        if (s < 3600) return Math.floor(s / 60) + ' min ' + String(Math.round(s % 60)).padStart(2, '0') + ' s'
        return Math.floor(s / 3600) + ' h ' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ' min'
      }
      /** Local calendar day, YYYY-MM-DD (the person's day, as the host counts it). */
      const dayKey = (ms) => {
        const d = new Date(ms)
        const p = (n) => String(n).padStart(2, '0')
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      }
      const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }
      /** "Today, Monday 9 November", "Yesterday, Sunday 8 November", "Friday 6 November" (and the year when it is not this one). */
      const dayLabel = (ms, now) => {
        let date = ''
        try {
          const opts = { weekday: 'long', day: 'numeric', month: 'long' }
          if (new Date(ms).getFullYear() !== new Date(now).getFullYear()) opts.year = 'numeric'
          date = new Date(ms).toLocaleDateString(locale(), opts).replace(/,/g, '')
        } catch (e) { date = dayKey(ms) }
        const k = dayKey(ms)
        if (k === dayKey(now)) return L('today') + ', ' + date
        if (k === dayKey(startOfDay(now) - 1)) return L('yesterday') + ', ' + date
        return date.slice(0, 1).toUpperCase() + date.slice(1)
      }

      // -- the rows: records merged into what a person reads ---------------------------------------------------------
      const FAILED = new Set(['failed', 'killed', 'error', 'timeout'])
      const TOOLISH = new Set(['tool', 'connector', 'websearch'])
      const tokensOf = (e) => (Number(e.input) || 0) + (Number(e.output) || 0) + (Number(e.cache) || 0)
      /**
       * Records (oldest first, as the host serves them) -> rows, newest first. Pure.
       *  - a tool call and its result are ONE row: matched by callId (a step that makes several calls records the calls first and
       *    the results after, so the nearest call is the wrong one); a record written before ids existed takes the latest open call
       *    of its chat. The row keeps the duration and, when it failed, the error.
       *  - a turn's start and its end are one row (per chat), and so are a job's start and end (per chat and kind of job).
       *  - a model call is its answer (the request and the selection only carry the route the answer already has).
       *  - an automatic title request takes the title its chat got right after it; chat titles themselves name the chats, they are not rows.
       */
      const buildRows = (records) => {
        const list = (Array.isArray(records) ? records : []).filter((r) => r !== null && typeof r === 'object' && typeof r.type === 'string')
        const out = []
        const calls = new Map()
        const open = new Map()
        const turns = new Map()
        const jobs = new Map()
        const asks = new Map()
        const take = (sid, row) => { const o = open.get(sid); if (o !== undefined) { const i = o.indexOf(row); if (i >= 0) o.splice(i, 1) } }
        for (const r of list) {
          const sid = typeof r.session === 'string' ? r.session : ''
          const base = { id: 'r' + (r.seq !== undefined ? r.seq : out.length) + '-' + r.at, seq: r.seq, at: r.at, type: r.type, kind: r.kind, session: sid === '' ? null : sid }
          if (r.provider !== undefined) base.provider = r.provider
          if (r.model !== undefined) base.model = r.model
          if (r.type === 'llm' && (r.kind === 'request' || r.kind === 'selection')) continue
          if (r.type === 'session' && r.kind === 'title') {
            const ask = asks.get(sid)
            if (ask !== undefined && ask.title === undefined && r.at - ask.at < 120000) ask.title = r.title
            continue
          }
          if (TOOLISH.has(r.type) && r.kind === 'call') {
            const row = { ...base, what: 'tool', name: r.tool || '', callId: r.callId }
            out.push(row)
            if (typeof r.callId === 'string' && r.callId !== '') calls.set(sid + '\u0001' + r.callId, row)
            if (!open.has(sid)) open.set(sid, [])
            open.get(sid).push(row)
            continue
          }
          if (r.type === 'tool' && r.kind === 'result') {
            const hasId = typeof r.callId === 'string' && r.callId !== ''
            let row = hasId ? calls.get(sid + '\u0001' + r.callId) : undefined
            if (row === undefined && !hasId) { const o = open.get(sid) || []; row = o[o.length - 1] }
            if (row === undefined || row.done === true) {
              row = { ...base, what: 'tool', name: '', callId: r.callId }
              out.push(row)
            } else take(sid, row)
            row.done = true
            row.end = r.at
            row.ok = r.ok
            if (r.ok === false) { row.state = 'error'; if (r.detail !== undefined) row.error = r.detail }
            continue
          }
          if (r.type === 'session' && (r.kind === 'turn-start' || r.kind === 'turn-end')) {
            if (r.kind === 'turn-start') { const row = { ...base, what: 'turn' }; out.push(row); turns.set(sid, row); continue }
            let row = turns.get(sid)
            if (row === undefined) { row = { ...base, what: 'turn' }; out.push(row) } else turns.delete(sid)
            row.done = true
            row.end = r.at
            row.status = r.status
            if (r.status === 'failed') { row.state = 'failed'; row.error = r.detail || r.error }
            continue
          }
          if (r.type === 'job') {
            const key = sid + '\u0001' + (r.tool || '')
            if (r.kind === 'start') { const row = { ...base, what: 'job', name: r.tool || '' }; out.push(row); jobs.set(key, row); continue }
            let row = jobs.get(key)
            if (row === undefined) { row = { ...base, what: 'job', name: r.tool || '' }; out.push(row) } else jobs.delete(key)
            row.done = true
            row.end = r.at
            row.status = r.status
            if (typeof r.status === 'string' && FAILED.has(r.status)) { row.state = 'failed'; row.error = r.status }
            continue
          }
          if (r.type === 'llm' && r.kind === 'answer') {
            out.push({ ...base, what: 'answer', input: Number(r.input) || 0, output: Number(r.output) || 0, cache: Number(r.cache) || 0, tokens: tokensOf(r) })
            continue
          }
          if (r.type === 'llm' && r.kind === 'retry') {
            out.push({ ...base, what: 'retry', state: 'retry', attempt: r.attempt, code: r.error, error: r.detail || r.error })
            continue
          }
          if (r.type === 'title') { const row = { ...base, what: 'title' }; out.push(row); asks.set(sid, row); continue }
          out.push({ ...base, what: r.type + ':' + r.kind, ...(r.error !== undefined ? { error: r.detail || r.error } : {}) })
        }
        return out.reverse()
      }

      /** Keep the rows a question asks for. `text(row)` is what a search reads (name, sub line, chat, model, error...). Pure. */
      const filterRows = (rows, f, text, now) => {
        const q = typeof f.q === 'string' && f.q.trim() !== '' ? f.q.trim().toLowerCase() : null
        const from = f.period === 'today' ? startOfDay(now) : f.period === 'week' ? startOfDay(now) - 6 * 86400000 : null
        const chip = f.chip === undefined || f.chip === 'all' ? null : f.chip
        return rows.filter((r) => (from === null || r.at >= from) &&
          (chip === null || chipOf(r.type) === chip) &&
          (f.errorsOnly !== true || typeof r.state === 'string') &&
          (q === null || text(r).toLowerCase().includes(q)))
      }
      /** What makes two failures "the same": the kind of row, the state, the name and the error. A success is never collapsed. */
      const failureKey = (r) => (typeof r.state === 'string' ? [r.state, r.type, r.what, r.name || '', r.provider || '', r.model || '', r.error || ''].join('\u0001') : null)
      /** Consecutive rows with the same failure become one row that holds its repeats (newest first). Pure. */
      const collapse = (rows) => {
        const out = []
        let lastKey = null
        for (const r of rows) {
          const k = failureKey(r)
          if (k !== null && k === lastKey) { out[out.length - 1].repeats.push(r); continue }
          out.push({ ...r, repeats: [r] })
          lastKey = k
        }
        return out
      }
      /** The rows as listed: filtered, then collapsed. Every count of the page is the length of one of these lists. */
      const listing = (rows, f, text, now) => collapse(filterRows(rows, f, text, now))
      /** "1 2 3 ... 60": the first, the last, the current one and its neighbours; a gap is one ellipsis. */
      const pageItems = (page, pages) => {
        if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
        const keep = new Set([1, pages, page - 1, page, page + 1])
        if (page <= 3) { keep.add(2); keep.add(3); keep.add(4) }
        if (page >= pages - 2) { keep.add(pages - 1); keep.add(pages - 2); keep.add(pages - 3) }
        const list = Array.from(keep).filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)
        const out = []
        for (let i = 0; i < list.length; i += 1) {
          if (i > 0 && list[i] - list[i - 1] > 1) out.push('\u2026')
          out.push(list[i])
        }
        return out
      }

      // -- the terminal: lines as they are shown ---------------------------------------------------------------------
      const pluginTag = (line) => { const m = /^\[([A-Za-z0-9@][\w.@/-]{0,40})\]/.exec(line); return m === null ? null : m[1] }
      const DSH_START = /^dsh web: http/
      /** Lines (newest last) -> what the box shows: identical consecutive lines are one line with its count, a DSH start opens a separator. Pure. */
      const termView = (lines) => {
        const out = []
        for (const l of Array.isArray(lines) ? lines : []) {
          const last = out[out.length - 1]
          if (last !== undefined && last.text === l.text) { last.count += 1; last.last = l.n; continue }
          out.push({ n: l.n, last: l.n, text: l.text, count: 1, start: DSH_START.test(l.text), tag: pluginTag(l.text) })
        }
        return out
      }

      // -- the conversation seam: the chat a row belongs to can be opened when the workspace offers it ----------------
      let ctxRef = null
      const workspace = () => { try { return ctxRef !== null && typeof ctxRef.get === 'function' ? ctxRef.get('uiWorkspace') : null } catch (e) { return null } }
      const canOpenChat = () => { const w = workspace(); return w !== null && w !== undefined && typeof w.openSession === 'function' }
      const openChat = (id) => {
        try {
          const w = workspace()
          if (w === null || w === undefined || typeof w.openSession !== 'function') return false
          // Settings is a full-window layer, Electron included: leave it before opening the chat, or the navigation happens out of sight.
          try {
            if (typeof document.querySelector === 'function' && document.querySelector('[data-shortcut-modal="settings"]') !== null && typeof document.dispatchEvent === 'function') {
              document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            }
          } catch (e) { /* no open Settings, or no keyboard event: still try the chat */ }
          w.openSession(id)
          return true
        } catch (e) { return false }
      }

      const getJson = async (url) => {
        const r = await window.fetch(url, { credentials: 'same-origin' })
        let json = null
        try { json = await r.json() } catch (e) { json = null }
        return { status: r.status, json }
      }

      // -- the page ------------------------------------------------------------------------------------------------
      const PER_PAGE = [25, 50, 100, 200]
      const RING_PAGES = 10
      const LIVE_MS = 3000
      const FOLLOW_MS = 2000
      const TERM_KEEP = 5000
      const Page = () => {
        // What came from the host lives in one ref (async loads never read a stale copy), and `rev` re-renders when it changes.
        const store = useRef({ records: [], pending: [], titles: {}, seen: new Set(), loaded: false, err: false, stats: null, statsErr: false, rev: 0 })
        const term = useRef({ lines: [], total: 0, hasOlder: false, truncated: false, plugins: [], state: 'idle', file: '', stick: true })
        const termBody = useRef(null)
        const [, bump] = useState(0)
        const redraw = () => bump((n) => n + 1)
        const rootRef = useRef(null)
        const [narrow, setNarrow] = useState(false)
        const [tab, setTab] = useState('calls')
        const [chip, setChip] = useState('all')
        const [q, setQ] = useState('')
        const [period, setPeriod] = useState('week')
        const [errorsOnly, setErrorsOnly] = useState(false)
        const [live, setLive] = useState(true)
        const [page, setPage] = useState(1)
        const [per, setPer] = useState(50)
        const [open, setOpen] = useState('')
        const [menu, setMenu] = useState(false)
        const [copied, setCopied] = useState(false)
        const [tStream, setTStream] = useState('out')
        const [tQ, setTQ] = useState('')
        const [tPlugin, setTPlugin] = useState('')
        const [follow, setFollow] = useState(true)
        const st = store.current

        const remember = (events, titles) => {
          const fresh = []
          for (const e of Array.isArray(events) ? events : []) {
            if (e === null || typeof e !== 'object') continue
            const k = e.seq !== undefined ? 's' + e.seq : 'a' + e.at + e.type + e.kind
            if (st.seen.has(k)) continue
            st.seen.add(k)
            fresh.push(e)
          }
          if (titles !== null && typeof titles === 'object') Object.assign(st.titles, titles)
          return fresh
        }
        const loadStats = async () => {
          try {
            const { json } = await getJson('/kybernos-log/stats?days=1')
            if (json !== null && json.ok === true && Array.isArray(json.days)) { st.stats = json.days[0] || null; st.statsErr = false } else st.statsErr = true
          } catch (e) { st.statsErr = true }
        }
        // The whole ring, once: pages of 500, oldest page last, until the host says there is no more.
        const loadAll = async () => {
          try {
            let before = null
            let all = []
            const titles = {}
            st.seen = new Set()
            for (let i = 0; i < RING_PAGES; i += 1) {
              const p = new URLSearchParams({ limit: '500' })
              if (before !== null) p.set('before', String(before))
              const { json } = await getJson('/kybernos-log/events?' + p.toString())
              if (json === null || json.ok !== true) throw new Error('no answer')
              const events = Array.isArray(json.events) ? json.events : []
              all = events.concat(all)
              Object.assign(titles, json.titles || {})
              if (json.hasMore !== true || events.length === 0 || typeof events[0].seq !== 'number') break
              before = events[0].seq
            }
            st.titles = {}
            st.records = remember(all, titles)
            st.pending = []
            st.err = false
          } catch (e) { st.err = true }
          st.loaded = true
          await loadStats()
          st.rev += 1
          redraw()
        }
        // Live: only what is new since the newest record held. New rows wait in `pending` until the reader asks for them, so the
        // page never moves under them; a record that only completes a row already shown (a tool's result) is applied at once.
        const poll = async () => {
          try {
            const held = st.pending.length > 0 ? st.pending : st.records
            const since = held.length > 0 ? held[held.length - 1].at : 0
            const { json } = await getJson('/kybernos-log/events?limit=500&since=' + encodeURIComponent(String(since)))
            if (json === null || json.ok !== true) return
            const fresh = remember(json.events, json.titles)
            if (fresh.length > 0) { st.pending = st.pending.concat(fresh); st.rev += 1 }
            await loadStats()
            redraw()
          } catch (e) { /* the list keeps what it has */ }
        }
        const showPending = () => {
          st.records = st.records.concat(st.pending)
          st.pending = []
          st.rev += 1
          setPage(1)
          redraw()
        }

        useEffect(() => { loadAll() }, [])
        useEffect(() => {
          if (!live) return undefined
          const t = window.setInterval(poll, LIVE_MS)
          return () => window.clearInterval(t)
        }, [live])
        useEffect(() => {
          // The Settings panel is ~720 px on a desktop, so a viewport media query never fires there: the page measures its own box.
          const el = rootRef.current
          if (el === null || el === undefined || typeof window.ResizeObserver !== 'function') return undefined
          const ro = new window.ResizeObserver(() => { try { setNarrow(el.getBoundingClientRect().width < 600) } catch (e) { /* detached */ } })
          ro.observe(el)
          return () => ro.disconnect()
        }, [])
        useEffect(() => {
          if (!menu) return undefined
          // A click elsewhere closes the menu. Escape is caught on the menu itself (menuKey): Escape also closes Settings, and only the menu must go.
          const close = (ev) => { try { if (ev.target && ev.target.closest && ev.target.closest('.kblg-menuwrap')) return } catch (e) { /* close anyway */ } setMenu(false) }
          document.addEventListener('mousedown', close)
          return () => { document.removeEventListener('mousedown', close) }
        }, [menu])
        // A new question starts on page 1.
        useEffect(() => { setPage(1) }, [chip, q, period, errorsOnly, per])

        // -- the terminal tab: read from the end, older on demand, followed every 2 s --------------------------------
        const termUrl = (extra) => {
          const p = new URLSearchParams({ stream: tStream, limit: '500' })
          if (tQ.trim() !== '') p.set('q', tQ.trim())
          if (tPlugin !== '') p.set('plugin', tPlugin)
          for (const k of Object.keys(extra || {})) p.set(k, String(extra[k]))
          return '/kybernos-log/terminal?' + p.toString()
        }
        const termRead = (status, json) => {
          const t = term.current
          if (status === 401) { t.state = 'signin'; return null }
          if (json === null || json.ok !== true) { t.state = 'unreachable'; return null }
          t.file = typeof json.file === 'string' ? json.file : ''
          if (json.exists === false) { t.state = 'missing'; t.lines = []; t.total = 0; t.plugins = []; return null }
          t.state = 'ok'
          t.total = Number(json.total) || 0
          if (Array.isArray(json.plugins)) t.plugins = json.plugins
          return json
        }
        const termLoad = async () => {
          try {
            const { status, json } = await getJson(termUrl())
            const got = termRead(status, json)
            if (got !== null) { term.current.lines = Array.isArray(got.lines) ? got.lines : []; term.current.hasOlder = got.hasOlder === true; term.current.truncated = got.truncated === true; term.current.stick = true }
          } catch (e) { term.current.state = 'unreachable' }
          redraw()
        }
        const termOlder = async () => {
          const t = term.current
          if (t.lines.length === 0) return
          try {
            const { status, json } = await getJson(termUrl({ before: t.lines[0].n }))
            const got = termRead(status, json)
            if (got !== null) { t.lines = (Array.isArray(got.lines) ? got.lines : []).concat(t.lines); t.hasOlder = got.hasOlder === true; t.truncated = got.truncated === true; t.stick = false }
          } catch (e) { /* the box keeps what it has */ }
          redraw()
        }
        const termFollow = async () => {
          const t = term.current
          if (t.state !== 'ok') return
          try {
            const after = t.lines.length > 0 ? t.lines[t.lines.length - 1].n : 0
            const { status, json } = await getJson(termUrl({ after }))
            const got = termRead(status, json)
            if (got !== null && Array.isArray(got.lines) && got.lines.length > 0) {
              // Stay at the newest line only when the reader is already there: scrolling up to read stops the box from moving.
              const el = termBody.current
              t.stick = el === null || el === undefined || typeof el.scrollHeight !== 'number' || el.scrollHeight - el.scrollTop - el.clientHeight < 40
              t.lines = t.lines.concat(got.lines)
              if (t.lines.length > TERM_KEEP) { t.lines = t.lines.slice(t.lines.length - TERM_KEEP); t.hasOlder = true }
            }
          } catch (e) { /* next tick */ }
          redraw()
        }
        useEffect(() => { if (tab === 'terminal') termLoad() }, [tab, tStream, tQ, tPlugin])
        // A terminal opens at its newest line (the bottom), and stays there while it is followed.
        useEffect(() => {
          const el = termBody.current
          if (tab === 'terminal' && term.current.stick && el !== null && el !== undefined && typeof el.scrollHeight === 'number') el.scrollTop = el.scrollHeight
        }, [tab, term.current.lines.length, term.current.state, tStream])
        useEffect(() => {
          if (tab !== 'terminal' || !follow) return undefined
          const t = window.setInterval(termFollow, FOLLOW_MS)
          return () => window.clearInterval(t)
        }, [tab, follow, tStream, tQ, tPlugin])

        // -- what a row says ---------------------------------------------------------------------------------------
        const nameOf = (r) => {
          if (r.what === 'answer' || r.what === 'retry') return r.model !== undefined ? String(r.provider || '') + '/' + String(r.model) : (r.provider || fam('llm'))
          if (r.what === 'tool') return r.name || L('nToolResult')
          if (r.what === 'turn') return L('nTurn')
          if (r.what === 'title') return L('nAutoTitle')
          if (r.what === 'job') return r.name || L('nJob')
          if (r.what === 'compaction:summary') return L('nCompaction')
          if (r.what === 'approval:asked') return L('nApprovalAsked')
          if (r.what === 'approval:decided') return L('nApprovalDecided')
          if (r.type === 'sandbox') return L('nSandbox')
          if (r.type === 'probe') return L('nProbe')
          return fam(r.type)
        }
        const subOf = (r) => {
          if (typeof r.state === 'string' && r.what !== 'retry') return r.error || (r.state === 'error' ? L('pError') : L('pFailed'))
          if (r.what === 'answer') return L('inOut', { i: fmt(r.input), o: fmt(r.output) }) + (r.cache > 0 ? ' \u00b7 ' + L('cacheSub', { c: fmt(r.cache) }) : '')
          if (r.what === 'retry') return [r.attempt !== undefined ? L('retryN', { n: r.attempt }) : '', r.code || '', r.error !== r.code ? r.error || '' : ''].filter((x) => x !== '').join(' \u00b7 ')
          if (r.what === 'tool') return r.done === true ? dur(r.end - r.at) : (r.type === 'tool' ? L('running') : fam(r.type))
          if (r.what === 'turn') return r.done === true ? L('completedIn', { d: dur(r.end - r.at) }) : L('running')
          if (r.what === 'job') return r.done === true ? [r.status || '', dur(r.end - r.at)].filter((x) => x !== '').join(' \u00b7 ') : L('running')
          if (r.what === 'title') return r.title !== undefined ? '\u201c' + r.title + '\u201d' : ''
          return ''
        }
        const chatOf = (r) => (r.session === null ? L('noChat') : (st.titles[r.session] || String(r.session).slice(0, 8)))
        const textOf = (r) => [nameOf(r), subOf(r), chatOf(r), r.provider, r.model, r.error, r.session, r.callId].filter(Boolean).join(' ')
        const pillOf = (r) => (r.state === 'retry' ? L('pRetry') : r.state === 'error' ? L('pError') : r.state === 'failed' ? L('pFailed') : '')

        const now = Date.now()
        let rows = useMemo(() => buildRows(st.records), [st.rev])
        // The chat titles: those the host sent, then the ones the ring itself holds (a title record names its chat).
        for (const r of st.records.concat(st.pending)) if (r.type === 'session' && r.kind === 'title' && typeof r.session === 'string' && typeof r.title === 'string') st.titles[r.session] = r.title
        const filters = { chip, q, period, errorsOnly }
        let list = listing(rows, filters, textOf, now)
        let newCount = 0
        if (st.pending.length > 0) {
          const withNew = buildRows(st.records.concat(st.pending))
          const grown = listing(withNew, filters, textOf, now)
          newCount = grown.length - list.length
          // Records that add no row (a result that completes a call already shown, a repeat of the failure on top) change rows in place: applied now.
          if (newCount <= 0) { st.records = st.records.concat(st.pending); st.pending = []; st.rev += 1; rows = withNew; list = grown; newCount = 0 }
        }
        const counts = { all: listing(rows, { ...filters, chip: 'all' }, textOf, now).length }
        for (const c of CHIPS) counts[c.key] = listing(rows, { ...filters, chip: c.key }, textOf, now).length
        const errorsCount = listing(rows, { ...filters, errorsOnly: true }, textOf, now).length
        const pages = Math.max(1, Math.ceil(list.length / per))
        const cur = Math.min(page, pages)
        const shown = list.slice((cur - 1) * per, cur * per)
        const days = new Map()
        for (const r of list) {
          const k = dayKey(r.at)
          const d = days.get(k) || { n: 0, tokens: 0 }
          d.n += 1
          for (const x of r.repeats) d.tokens += x.tokens || 0
          days.set(k, d)
        }

        // -- today's cards: the same records, and the host's hours for the sparklines -------------------------------
        const todayKey = dayKey(now)
        const todayRecs = st.records.filter((r) => dayKey(r.at) === todayKey)
        const cards = {
          calls: todayRecs.filter((r) => r.type === 'llm' && r.kind === 'answer').length,
          tokens: todayRecs.reduce((a, r) => a + tokensOf(r), 0),
          // every failure of today, the collapsed repeats included: a row that reads "failed x3" is three failures (measured 2026-11-09:
          // an automation failing every 30 min showed "3" on this card while the host counted 106 that day)
          failures: listing(rows, { chip: 'all', q: '', period: 'today', errorsOnly: true }, textOf, now).reduce((n, r) => n + (Array.isArray(r.repeats) ? r.repeats.length : 1), 0),
          unasked: todayRecs.filter((r) => r.type === 'title' || r.type === 'compaction' || r.type === 'probe').length
        }
        const hours = st.stats !== null && Array.isArray(st.stats.hours) && st.stats.day === todayKey ? st.stats.hours : null
        const spark = (field, bad) => {
          if (hours === null) return h('div', { className: 'kblg-spark is-none', title: L('noHours'), 'aria-label': L('noHours'), role: 'img' })
          const vals = hours.map((x) => Number(x && x[field]) || 0)
          const max = Math.max(1, ...vals)
          return h('div', { className: 'kblg-spark', role: 'img', 'aria-label': L('perHour') + ': ' + vals.join(', ') },
            vals.map((v, i) => h('i', { key: i, style: { height: (v === 0 ? 0 : Math.max(8, Math.round((v / max) * 100))) + '%' } })))
        }
        const card = (key, value, label, bad) => {
          const body = [h('b', { key: 'v' }, value), h('span', { key: 'l' }, label + (bad ? ' \u2192' : '')), h('div', { key: 's' }, spark(key, bad))]
          if (bad) {
            return h('button', { type: 'button', className: 'kblg-card is-bad', 'data-card': key, title: L('cardFailuresHint'), onClick: () => { setErrorsOnly(true); setPeriod('today'); setTab('calls') } }, body)
          }
          return h('div', { className: 'kblg-card', 'data-card': key }, body)
        }

        const clearFilters = () => { setChip('all'); setQ(''); setErrorsOnly(false); setPeriod('all') }
        const copyJson = async () => {
          setMenu(false)
          const out = list.map((r) => ({ at: new Date(r.at).toISOString(), family: r.type, what: nameOf(r), detail: subOf(r), chat: chatOf(r), state: r.state || null, tokens: r.tokens || 0, times: r.repeats.length }))
          try { await navigator.clipboard.writeText(JSON.stringify(out, null, 2)); setCopied(true); window.setTimeout(() => setCopied(false), 1500) } catch (e) { /* no clipboard */ }
        }
        const menuKey = (ev) => {
          if (ev.key !== 'Escape' || !menu) return
          try { ev.stopPropagation(); ev.preventDefault() } catch (e) { /* synthetic */ }
          setMenu(false)
          try { const b = document.querySelector('.kblg-menuwrap > button'); if (b) b.focus() } catch (e) { /* focus is a nicety */ }
        }
        const tabKey = (ev) => {
          const order = ['calls', 'terminal']
          let next = null
          if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') next = order[(order.indexOf(tab) + 1) % 2]
          else if (ev.key === 'Home') next = 'calls'
          else if (ev.key === 'End') next = 'terminal'
          if (next === null) return
          try { ev.preventDefault() } catch (e) { /* synthetic */ }
          setTab(next)
          try { const el = document.getElementById('kblg-tab-' + next); if (el) el.focus() } catch (e) { /* focus is a nicety */ }
        }
        const tabBtn = (key, label) => h('button', {
          type: 'button', role: 'tab', id: 'kblg-tab-' + key, className: 'kblg-tab', 'aria-selected': tab === key ? 'true' : 'false',
          'aria-controls': 'kblg-panel-' + key, tabIndex: tab === key ? 0 : -1, onClick: () => setTab(key)
        }, label)

        // -- the Calls tab -----------------------------------------------------------------------------------------
        const detail = (r) => {
          const items = []
          const add = (k, v) => { if (v !== null && v !== undefined && v !== '') items.push(h('dt', { key: k + 't' }, L(k)), h('dd', { key: k + 'd' }, v)) }
          const sessions = new Set(r.repeats.map((x) => x.session).filter(Boolean))
          add('dChat', r.session === null ? L('noChat') : h(React.Fragment || 'span', null, chatOf(r),
            canOpenChat() ? [' \u00b7 ', h('button', { key: 'o', type: 'button', className: 'kblg-link', onClick: (ev) => { try { ev.stopPropagation() } catch (e) { /* synthetic */ } openChat(r.session) } }, L('openChat'))] : null))
          add('dProvider', r.provider)
          add('dModel', r.model)
          if (r.what === 'answer') add('dTokens', L('dTokensVal', { i: count(r.input), o: count(r.output), c: count(r.cache) }))
          if (r.done === true && typeof r.end === 'number' && r.end - r.at >= 100) add('dDuration', dur(r.end - r.at))
          add('dError', r.error)
          // The times of the repeats, newest first; a long run shows its first twelve (the day too when it spans several).
          const spans = new Set(r.repeats.map((x) => dayKey(x.at))).size > 1
          const when = (x) => (spans ? new Date(x.at).getDate() + '/' + String(new Date(x.at).getMonth() + 1).padStart(2, '0') + ' ' : '') + clock(x.at)
          const times = r.repeats.slice(0, 12).map(when).join(', ') + (r.repeats.length > 12 ? ', \u2026' : '')
          if (r.repeats.length > 1) add('dRepeats', L('dRepeatsVal', { n: count(r.repeats.length), times }) + (sessions.size > 1 ? ' \u00b7 ' + L('dRepeatsChats', { n: sessions.size }) : ''))
          add('dCallId', r.callId)
          add('dChatId', r.session)
          return h('dl', { className: 'kblg-open', key: r.id + '-open', id: 'kblg-open-' + r.id }, items)
        }
        const row = (r) => {
          const isOpen = open === r.id
          const pill = pillOf(r)
          const toggle = () => setOpen(isOpen ? '' : r.id)
          const tokens = r.repeats.reduce((a, x) => a + (x.tokens || 0), 0)
          const out = [h('div', {
            key: r.id, className: 'kblg-row', role: 'button', tabIndex: 0, 'aria-expanded': isOpen ? 'true' : 'false', 'aria-controls': 'kblg-open-' + r.id,
            'data-state': r.state || '', 'data-family': r.type, onClick: toggle,
            onKeyDown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { try { ev.preventDefault() } catch (e) { /* synthetic */ } toggle() } }
          },
          h('span', { className: 'kblg-t' }, clock(r.at)),
          icon(chipOf(r.type)),
          h('span', { className: 'kblg-w' }, h('b', null, nameOf(r)), h('small', null, subOf(r) || '\u00a0'), h('small', { className: 'kblg-chat2' }, chatOf(r))),
          h('span', { className: 'kblg-chat' }, chatOf(r)),
          h('span', null, pill === '' ? null : h('span', { className: 'kblg-pill ' + (r.state === 'retry' ? 'is-warn' : 'is-err') }, pill + (r.repeats.length > 1 ? ' \u00d7' + r.repeats.length : ''))),
          h('span', { className: 'kblg-n' }, tokens > 0 ? fmt(tokens) : ''))]
          if (isOpen) out.push(detail(r))
          return out
        }
        const body = []
        let lastDay = null
        for (const r of shown) {
          const k = dayKey(r.at)
          if (k !== lastDay) {
            const d = days.get(k) || { n: 0, tokens: 0 }
            body.push(h('div', { key: 'day-' + k, className: 'kblg-day', role: 'heading', 'aria-level': 3 }, dayLabel(r.at, now),
              h('span', null, d.n === 1 ? L('dayTotalOne', { t: fmt(d.tokens) }) : L('dayTotal', { n: count(d.n), t: fmt(d.tokens) }))))
            lastDay = k
          }
          body.push(...row(r))
        }
        const filtered = chip !== 'all' || q.trim() !== '' || errorsOnly || period !== 'all'
        let empty = null
        if (list.length === 0) {
          if (st.err && st.records.length === 0) empty = h('div', { className: 'kblg-empty', 'data-empty': 'unreachable' }, h('span', { className: 'kblg-err' }, L('unreachable')))
          else if (!st.loaded) empty = h('div', { className: 'kblg-empty', 'data-empty': 'loading' }, '\u2026')
          else if (rows.length === 0) empty = h('div', { className: 'kblg-empty', 'data-empty': 'nothing' }, L('nothingYet'))
          else if (filtered) empty = h('div', { className: 'kblg-empty', 'data-empty': 'nomatch' }, h('span', null, L('noMatch')), h('button', { type: 'button', className: 'kblg-btn', onClick: clearFilters }, L('clear')))
          else empty = h('div', { className: 'kblg-empty', 'data-empty': 'nothing' }, L('nothingYet'))
        }
        const pager = list.length === 0 ? null : h('div', { className: 'kblg-pager' },
          h('span', { className: 'kblg-range' }, L('pager', { a: count((cur - 1) * per + 1), b: count(Math.min(list.length, cur * per)), n: count(list.length) })),
          h('nav', { className: 'kblg-pages', 'aria-label': L('pages') },
            h('button', { type: 'button', className: 'kblg-pg', 'aria-label': L('prev'), disabled: cur <= 1, onClick: () => setPage(cur - 1) }, '\u2039'),
            pageItems(cur, pages).map((n, i) => (n === '\u2026'
              ? h('span', { key: 'g' + i, className: 'kblg-gap' }, '\u2026')
              : h('button', { key: n, type: 'button', className: 'kblg-pg', 'aria-label': L('goPage', { n }), 'aria-current': n === cur ? 'page' : undefined, onClick: () => setPage(n) }, String(n)))),
            h('button', { type: 'button', className: 'kblg-pg', 'aria-label': L('next'), disabled: cur >= pages, onClick: () => setPage(cur + 1) }, '\u203a')),
          h('select', { className: 'kblg-sel', 'aria-label': L('perPageLabel'), value: String(per), onChange: (e) => setPer(Number(e.target.value) || 50) },
            PER_PAGE.map((n) => h('option', { key: n, value: String(n) }, L('perPage', { n })))))
        const chips = h('div', { className: 'kblg-chips', role: 'group', 'aria-label': L('families') },
          h('button', { type: 'button', className: 'kblg-chip', 'data-chip': 'all', 'aria-pressed': chip === 'all' ? 'true' : 'false', onClick: () => setChip('all') }, L('chipAll'), h('b', null, count(counts.all))),
          CHIPS.filter((c) => counts[c.key] > 0 || chip === c.key).map((c) => h('button', {
            key: c.key, type: 'button', className: 'kblg-chip', 'data-chip': c.key, 'aria-pressed': chip === c.key ? 'true' : 'false', onClick: () => setChip(chip === c.key ? 'all' : c.key)
          }, icon(c.icon), L(c.label), h('b', null, count(counts[c.key])))))
        const toolbar = h('div', { className: 'kblg-bar' },
          h('input', { className: 'kblg-in', type: 'search', value: q, placeholder: L('search'), 'aria-label': L('search'), onChange: (e) => setQ(e.target.value) }),
          h('select', { className: 'kblg-sel', 'aria-label': L('period'), value: period, onChange: (e) => setPeriod(e.target.value) },
            h('option', { value: 'today' }, L('pToday')), h('option', { value: 'week' }, L('pWeek')), h('option', { value: 'all' }, L('pAll'))),
          h('button', { type: 'button', className: 'kblg-btn is-err', 'data-toggle': 'errors', 'aria-pressed': errorsOnly ? 'true' : 'false', onClick: () => setErrorsOnly(!errorsOnly) }, L('errorsOnly'), h('b', null, count(errorsCount))),
          h('button', { type: 'button', className: 'kblg-btn', 'data-toggle': 'live', 'aria-pressed': live ? 'true' : 'false', onClick: () => setLive(!live) }, h('i', { className: 'kblg-dot', 'aria-hidden': 'true' }), L('live')),
          h('span', { className: 'kblg-menuwrap', onKeyDown: menuKey },
            h('button', { type: 'button', className: 'kblg-btn', 'aria-label': L('moreActions'), title: L('moreActions'), 'aria-haspopup': 'menu', 'aria-expanded': menu ? 'true' : 'false', onClick: () => setMenu(!menu) }, '\u00b7\u00b7\u00b7'),
            menu ? h('div', { className: 'kblg-menu', role: 'menu' },
              h('button', { type: 'button', role: 'menuitem', onClick: () => { setMenu(false); loadAll() } }, L('refresh')),
              h('button', { type: 'button', role: 'menuitem', onClick: copyJson }, L('export'))) : null,
            copied ? h('span', { className: 'kblg-copied', role: 'status' }, L('copied')) : null))
        const callsPanel = h('div', { role: 'tabpanel', id: 'kblg-panel-calls', 'aria-labelledby': 'kblg-tab-calls', className: 'kblg-panel' },
          toolbar,
          chips,
          st.err && st.records.length > 0 ? h('p', { className: 'kblg-err kblg-banner' }, L('unreachable')) : null,
          newCount > 0 ? h('div', { className: 'kblg-new' }, h('button', { type: 'button', onClick: showPending }, '\u2191 ' + (newCount === 1 ? L('newCall') : L('newCalls', { n: count(newCount) })))) : null,
          empty !== null ? empty : h('div', { className: 'kblg-rows', 'aria-label': L('rows') }, body),
          pager)

        // -- the Terminal tab --------------------------------------------------------------------------------------
        const t = term.current
        const view = termView(t.lines)
        const lineBody = (text) => {
          const tag = pluginTag(text)
          const rest = tag === null ? text : text.slice(tag.length + 2)
          const parts = rest.split('[hidden]')
          const spans = []
          parts.forEach((p, i) => { if (i > 0) spans.push(h('span', { key: 'm' + i, className: 'kblg-mask' }, '[hidden]')); if (p !== '') spans.push(p) })
          return [tag === null ? null : h('span', { key: 'tag', className: 'kblg-tag' }, '[' + tag + ']')].concat(spans)
        }
        const termLines = []
        for (const l of view) {
          if (l.start) termLines.push(h('span', { key: 'sep' + l.n, className: 'kblg-sep', role: 'separator' }, '\u2014 ' + L('tStarted') + ' \u2014'))
          termLines.push(h('div', { key: 'l' + l.n, className: 'kblg-tl' + (tStream === 'err' ? ' is-err' : ''), 'data-n': l.n }, lineBody(l.text), l.count > 1 ? h('span', { className: 'kblg-x' }, '\u00d7' + l.count) : null))
        }
        const copyLines = async () => {
          const text = view.map((l) => l.text + (l.count > 1 ? '  (\u00d7' + l.count + ')' : '')).join('\n')
          try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1500) } catch (e) { /* no clipboard */ }
        }
        let termBox
        if (t.state === 'unreachable') termBox = h('div', { className: 'kblg-empty', 'data-empty': 'unreachable' }, h('span', { className: 'kblg-err' }, L('tUnreachable')))
        else if (t.state === 'signin') termBox = h('div', { className: 'kblg-empty', 'data-empty': 'signin' }, L('tSignin'))
        else if (t.state === 'missing') termBox = h('div', { className: 'kblg-empty', 'data-empty': 'missing' }, L('tMissing', { file: t.file || (tStream === 'err' ? 'dsh-web.err.log' : 'dsh-web.out.log') }))
        else if (t.state === 'idle') termBox = h('div', { className: 'kblg-empty', 'data-empty': 'loading' }, '\u2026')
        else {
          termBox = h('div', { className: 'kblg-term' },
            h('div', { className: 'kblg-term-head' }, L('tHead', { n: count(t.total) }), t.file ? h('span', { className: 'kblg-file' }, t.file) : null),
            h('div', { className: 'kblg-term-body', role: 'log', 'aria-live': follow ? 'polite' : 'off', ref: termBody },
              t.hasOlder ? h('button', { type: 'button', className: 'kblg-older', onClick: termOlder }, '\u2191 ' + L('tOlder')) : null,
              t.truncated ? h('div', { className: 'kblg-tnote' }, L('tTruncated')) : null,
              termLines.length === 0 ? h('div', { className: 'kblg-tnote' }, L('tEmpty')) : termLines,
              follow ? h('div', { className: 'kblg-tnote' }, '\u258c ' + L('tFollowing')) : null))
        }
        const termPanel = h('div', { role: 'tabpanel', id: 'kblg-panel-terminal', 'aria-labelledby': 'kblg-tab-terminal', className: 'kblg-panel' },
          h('div', { className: 'kblg-bar' },
            h('div', { className: 'kblg-seg', role: 'group', 'aria-label': L('tStream') },
              h('button', { type: 'button', 'data-stream': 'out', 'aria-pressed': tStream === 'out' ? 'true' : 'false', onClick: () => setTStream('out') }, L('tOut')),
              h('button', { type: 'button', 'data-stream': 'err', 'aria-pressed': tStream === 'err' ? 'true' : 'false', onClick: () => setTStream('err') }, L('tErr'))),
            h('input', { className: 'kblg-in', type: 'search', value: tQ, placeholder: L('tFilter'), 'aria-label': L('tFilter'), onChange: (e) => setTQ(e.target.value) }),
            h('select', { className: 'kblg-sel', 'aria-label': L('tPlugin'), value: tPlugin, onChange: (e) => setTPlugin(e.target.value) },
              h('option', { value: '' }, L('tPlugins')),
              (t.plugins.some((p) => p.tag === tPlugin) || tPlugin === '' ? t.plugins : t.plugins.concat([{ tag: tPlugin, count: 0 }])).map((p) => h('option', { key: p.tag, value: p.tag }, '[' + p.tag + '] ' + count(p.count)))),
            h('button', { type: 'button', className: 'kblg-btn', 'data-toggle': 'follow', 'aria-pressed': follow ? 'true' : 'false', onClick: () => setFollow(!follow) }, h('i', { className: 'kblg-dot', 'aria-hidden': 'true' }), L('follow')),
            h('button', { type: 'button', className: 'kblg-btn', onClick: copyLines }, copied ? L('copied') : L('copy'))),
          termBox,
          h('p', { className: 'kblg-note' }, L('tNote')))

        return h('div', { className: 'kblg-page' + (narrow ? ' kblg-narrow' : ''), ref: rootRef },
          pageHead({ id: 'kybernos-log', lead: L('lead'), title: L('title'), className: 'kblg-title' }),
          // The description lives in the "?" card (`lead`); it stays under the title only where the Suite's Help does not exist.
          helpAbsent() ? h('p', { className: 'kblg-lead' }, L('lead')) : null,
          // "Metadata only" is a privacy statement about what the log keeps, not a description of the page: it stays.
          h('p', { className: 'kblg-priv' }, L('privacy')),
          h('div', { className: 'kblg-cards' },
            card('calls', count(cards.calls), L('cardCalls'), false),
            card('tokens', fmt(cards.tokens), L('cardTokens'), false),
            card('failures', count(cards.failures), L('cardFailures'), cards.failures > 0),
            card('unasked', count(cards.unasked), L('cardUnasked'), false)),
          h('div', { className: 'kblg-tabs', role: 'tablist', 'aria-label': L('tabs'), onKeyDown: tabKey },
            tabBtn('calls', L('tabCalls')), tabBtn('terminal', L('tabTerminal'))),
          tab === 'calls' ? callsPanel : termPanel)
      }

      // Colour only for states (error, warn, success); everything else is the theme's text and border tokens, with fallbacks.
      const CSS = `
.kblg-page{display:flex;flex-direction:column;gap:14px;max-width:100%;min-width:0}
.kblg-lead{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary,#9aa1a8)}
.kblg-priv{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kblg-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.kblg-card{border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:12px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.03));padding:11px 13px;display:flex;flex-direction:column;gap:6px;min-width:0;text-align:left;font:inherit;color:inherit;box-sizing:border-box}
.kblg-card b{font-size:19px;font-weight:650;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#e8eaec)}
.kblg-card span{font-size:12px;color:var(--dsw-alias-label-secondary,#9aa1a8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kblg-card.is-bad{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 45%,transparent);cursor:pointer}
.kblg-card.is-bad b{color:var(--dsw-alias-state-error-primary,#ef4444)}
.kblg-card.is-bad:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.kblg-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4176e6);outline-offset:1px}
.kblg-spark{display:flex;align-items:flex-end;gap:2px;height:20px}
.kblg-spark i{flex:1;background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#8a9096) 55%,transparent);border-radius:1px}
.kblg-card.is-bad .kblg-spark i{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 70%,transparent)}
.kblg-spark.is-none{height:10px;margin-top:10px;border-bottom:1px dashed var(--dsw-alias-border-l2,rgba(255,255,255,.12))}
.kblg-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.kblg-tab{padding:8px 12px;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary,#9aa1a8);background:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;cursor:pointer}
.kblg-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary,#e8eaec);border-bottom-color:var(--dsw-alias-label-primary,#e8eaec);font-weight:600}
.kblg-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4176e6);outline-offset:-2px;border-radius:6px}
.kblg-panel{display:flex;flex-direction:column;gap:12px;min-width:0}
.kblg-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.kblg-in{flex:1;min-width:180px;height:30px;box-sizing:border-box;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.03));color:var(--dsw-alias-label-primary,#e8eaec);font:inherit;font-size:12.5px;padding:0 10px}
.kblg-in:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#4176e6)}
.kblg-sel{height:30px;box-sizing:border-box;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.03));color:var(--dsw-alias-label-primary,#e8eaec);font:inherit;font-size:12.5px;padding:0 8px;cursor:pointer}
.kblg-sel:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4176e6);outline-offset:1px}
.kblg-btn{height:30px;box-sizing:border-box;padding:0 11px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:transparent;color:var(--dsw-alias-label-primary,#e8eaec);font:inherit;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.kblg-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.kblg-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4176e6);outline-offset:1px}
.kblg-btn b{font-weight:500;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kblg-btn.is-err[aria-pressed="true"]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 50%,transparent);color:var(--dsw-alias-state-error-primary,#ef4444);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 8%,transparent)}
.kblg-btn.is-err[aria-pressed="true"] b{color:inherit}
.kblg-dot{width:7px;height:7px;border-radius:9px;background:var(--dsw-alias-label-tertiary,#8a9096)}
.kblg-btn[aria-pressed="true"] .kblg-dot{background:var(--dsw-alias-state-success-primary,#22c55e)}
.kblg-menuwrap{position:relative;display:inline-flex;align-items:center;gap:8px}
.kblg-menu{position:absolute;right:0;top:34px;z-index:5;min-width:170px;padding:4px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:var(--dsw-alias-bg-layer-3,#353638);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.2));display:flex;flex-direction:column}
.kblg-menu button{height:30px;text-align:left;padding:0 10px;border:0;border-radius:7px;background:none;color:var(--dsw-alias-label-primary,#e8eaec);font:inherit;font-size:12.5px;cursor:pointer}
.kblg-menu button:hover,.kblg-menu button:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));outline:none}
.kblg-copied{font-size:12px;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kblg-chips{display:flex;flex-wrap:wrap;gap:6px}
.kblg-chip{height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:transparent;color:var(--dsw-alias-label-secondary,#9aa1a8);font:inherit;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.kblg-chip[aria-pressed="true"]{border-color:var(--dsw-alias-label-primary,#e8eaec);color:var(--dsw-alias-label-primary,#e8eaec)}
.kblg-chip b{font-weight:500;color:var(--dsw-alias-label-tertiary,#8a9096);font-variant-numeric:tabular-nums}
.kblg-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4176e6);outline-offset:1px}
.kblg-ico{width:16px;height:16px;display:inline-grid;place-items:center;color:var(--dsw-alias-label-tertiary,#8a9096);flex:none}
.kblg-new{display:flex;justify-content:center}
.kblg-new button{font:inherit;font-size:12px;padding:4px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.03));color:var(--dsw-alias-label-primary,#e8eaec);cursor:pointer}
.kblg-banner{margin:0;font-size:12px}
.kblg-rows{display:flex;flex-direction:column;min-width:0}
.kblg-day{position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-2,#2c2c2e);font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-tertiary,#8a9096);padding:10px 4px 6px;display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.kblg-day span{font-weight:400;font-variant-numeric:tabular-nums}
.kblg-row{display:grid;grid-template-columns:62px 16px minmax(0,1fr) minmax(0,170px) 78px 56px;gap:10px;align-items:center;padding:7px 4px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));font-size:12.5px;cursor:pointer}
.kblg-row:hover,.kblg-row[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04))}
.kblg-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4176e6);outline-offset:-2px;border-radius:6px}
.kblg-t{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kblg-w{min-width:0;display:flex;flex-direction:column}
.kblg-w b{font-weight:500;color:var(--dsw-alias-label-primary,#e8eaec);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kblg-w small{color:var(--dsw-alias-label-tertiary,#8a9096);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11.5px}
.kblg-w .kblg-chat2{display:none}
.kblg-chat{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary,#9aa1a8);min-width:0}
.kblg-n{text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#9aa1a8)}
.kblg-pill{display:inline-block;font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));white-space:nowrap}
.kblg-pill.is-err{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 50%,transparent);color:var(--dsw-alias-state-error-primary,#ef4444)}
.kblg-pill.is-warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 50%,transparent);color:color-mix(in srgb,var(--dsw-alias-state-warn-label,#a8530a) 55%,var(--dsw-alias-label-primary,#222))}
.kblg-open{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04));border-radius:0 0 10px 10px;margin:0 0 8px;padding:10px 12px;display:grid;grid-template-columns:150px minmax(0,1fr);gap:4px 12px;font-size:12px}
.kblg-open dt{color:var(--dsw-alias-label-tertiary,#8a9096)}
.kblg-open dd{margin:0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary,#e8eaec)}
.kblg-link{background:none;border:0;padding:0;font:inherit;color:var(--dsw-alias-label-primary,#e8eaec);text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.kblg-pager{display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap;padding-top:6px;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kblg-range{font-variant-numeric:tabular-nums}
.kblg-pages{display:flex;gap:4px;align-items:center}
.kblg-pg{min-width:28px;height:28px;border-radius:8px;border:1px solid transparent;background:none;color:var(--dsw-alias-label-secondary,#9aa1a8);font:inherit;font-size:12px;font-variant-numeric:tabular-nums;cursor:pointer;padding:0 6px}
.kblg-pg[aria-current="page"]{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.03));color:var(--dsw-alias-label-primary,#e8eaec);border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.12))}
.kblg-pg:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.kblg-pg:disabled{opacity:.4;cursor:default}
.kblg-pg:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4176e6);outline-offset:1px}
.kblg-gap{min-width:20px;text-align:center}
.kblg-mut{color:var(--dsw-alias-label-secondary,#9aa1a8)}
.kblg-err{color:var(--dsw-alias-state-error-primary,#ef4444)}
.kblg-warn{color:color-mix(in srgb,var(--dsw-alias-state-warn-label,#a8530a) 55%,var(--dsw-alias-label-primary,#222))}
.kblg-empty{padding:28px 8px;text-align:center;color:var(--dsw-alias-label-secondary,#9aa1a8);font-size:13px;display:flex;flex-direction:column;align-items:center;gap:10px}
.kblg-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:9px;padding:2px;gap:2px;height:30px;box-sizing:border-box}
.kblg-seg button{padding:0 10px;border:0;border-radius:7px;background:none;color:var(--dsw-alias-label-secondary,#9aa1a8);font:inherit;font-size:12.5px;cursor:pointer}
.kblg-seg button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#e8eaec);font-weight:600}
.kblg-seg button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4176e6);outline-offset:1px}
.kblg-term{background:var(--dsw-alias-markdown-code-block,#1b1b1c);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:12px;overflow:hidden}
.kblg-term-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));font-size:12px;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kblg-file{font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px}
.kblg-term-body{margin:0;padding:10px 12px;max-height:520px;overflow:auto;font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:1.55;color:var(--dsw-alias-label-primary,#e8eaec)}
.kblg-tl{white-space:pre-wrap;word-break:break-word}
.kblg-tl.is-err{color:var(--dsw-alias-state-error-primary,#ef4444)}
.kblg-tag{color:color-mix(in srgb,var(--dsw-alias-link,#7aaaff) 65%,var(--dsw-alias-label-secondary,#9aa1a8))}
.kblg-tl.is-err .kblg-tag{color:inherit}
.kblg-mask{background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.08));color:var(--dsw-alias-label-tertiary,#8a9096);border-radius:3px;padding:0 4px}
.kblg-x{margin-left:8px;background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.08));color:var(--dsw-alias-label-tertiary,#8a9096);border-radius:3px;padding:0 4px;font-size:11px}
.kblg-sep{display:block;color:var(--dsw-alias-label-tertiary,#8a9096);border-top:1px dashed var(--dsw-alias-border-l3,rgba(255,255,255,.16));margin:6px 0 4px;padding-top:4px}
.kblg-older{display:block;background:none;border:0;padding:0 0 6px;font:inherit;color:var(--dsw-alias-label-tertiary,#8a9096);cursor:pointer}
.kblg-older:hover{color:var(--dsw-alias-label-primary,#e8eaec)}
.kblg-tnote{color:var(--dsw-alias-label-tertiary,#8a9096)}
.kblg-note{margin:0;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8a9096)}
/* The Settings panel is ~720 px wide on a desktop viewport, so a viewport media query alone never fires there:
   the page takes a kblg-narrow class when its own box is under 600 px, and the chat moves under What as a second sub line. */
.kblg-page.kblg-narrow .kblg-cards{grid-template-columns:repeat(2,minmax(0,1fr))}
.kblg-page.kblg-narrow .kblg-row{grid-template-columns:58px 16px minmax(0,1fr) auto 48px;gap:8px}
.kblg-page.kblg-narrow .kblg-row > .kblg-chat{display:none}
.kblg-page.kblg-narrow .kblg-w .kblg-chat2{display:block}
.kblg-page.kblg-narrow .kblg-open{grid-template-columns:110px minmax(0,1fr)}
`

      return {
        name: 'kybernos-log',
        inject: ['slots', 'uiWorkspace'],
        __test: { S, L, kt, TYPES, FAM, CHIPS, fam, fmt, count, dur, tokensOf, clock, dayKey, dayLabel, buildRows, filterRows, collapse, listing, pageItems, termView, pluginTag },
        apply (ctx) {
          ctxRef = ctx
          try {
            const s = document.createElement('style')
            s.setAttribute('data-plugin', '@local/kybernos-log')
            s.textContent = CSS
            document.head.appendChild(s)
          } catch (e) { /* no head: the page still renders unstyled */ }
          ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register(
            { name: 'settings.section', id: 'kybernos-log', order: 34, label: () => kt('Journal d’activité', 'Activity log') },
            () => { try { return h(Page) } catch (e) { return null } }
          )), 'kybernos-log: settings page')
        }
      }
    } catch (error) {
      try { console.error('[kybernos-log] load failed - plugin disabled, GUI preserved', error) } catch (e) { /* no console */ }
      return { apply () { /* disabled after a load error */ } }
    }
  }
})
