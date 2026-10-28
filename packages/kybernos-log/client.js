// kybernos-log — browser half: the Settings page behind « Activity log » (System group).
//
// One question, one page: what did this machine send out, and what did it cost? The host follows every session
// event (`session/event`), keeps METADATA ONLY (never a message body, never a tool argument) and serves it from
// `/kybernos-log/events`, `/kybernos-log/stats` and the live `/kybernos-log/stream`.
//
// The page is a filter bench: chips by family (model calls, connectors, web search, tools, hidden calls…), a
// search field, a session filter and a live switch. Everything is read-only; nothing here can send anything.
//
// No engine patch. Loaded through window.__ModuleLoader__.load; the factory RETURNS a plugin object and, on any
// error, a disabled one, so the GUI is preserved.
window.__ModuleLoader__.load({
  id: '@local/kybernos-log',
  factory (require) {
    try {
      const React = require('react')
      const h = React.createElement

      // ── language: French is the source, English the pair ───────────────────────────────────────────────────
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
        privacy: ['Métadonnées seulement : aucun texte de message ni argument d’outil n’est enregistré.', 'Metadata only: no message text, no tool argument is recorded.'],
        filters: ['Familles', 'Families'],
        search: ['Rechercher (modèle, outil, session, erreur)…', 'Search (model, tool, session, error)…'],
        session: ['Session', 'Session'],
        all: ['Toutes', 'All'],
        live: ['En direct', 'Live'],
        liveOn: ['En direct — en pause', 'Live — paused'],
        refresh: ['Rafraîchir', 'Refresh'],
        export: ['Copier en JSON', 'Copy JSON'],
        copied: ['Copié', 'Copied'],
        empty: ['Rien à cette période : aucun appel ne correspond aux filtres.', 'Nothing in this window: no call matches the filters.'],
        unreachable: ['La route du journal ne répond pas (hôte pas encore relancé ?).', 'The journal route does not answer (host not restarted yet?).'],
        todayCalls: ['Appels modèle aujourd’hui', 'Model calls today'],
        todayTokens: ['Tokens aujourd’hui', 'Tokens today'],
        hidden: ['Appels non demandés', 'Unasked calls'],
        retries: ['Retries', 'Retries'],
        colTime: ['Heure', 'Time'],
        colFamily: ['Famille', 'Family'],
        colWhat: ['Quoi', 'What'],
        colSession: ['Session', 'Session'],
        colTokens: ['Tokens', 'Tokens'],
        colDetail: ['Détail', 'Detail'],
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

      const TYPES = ['llm', 'connector', 'websearch', 'tool', 'title', 'compaction', 'probe', 'approval', 'job', 'sandbox', 'session']
      const FAM = { llm: 'famLlm', connector: 'famConnector', websearch: 'famWebsearch', tool: 'famTool', title: 'famTitle', compaction: 'famCompaction', probe: 'famProbe', approval: 'famApproval', job: 'famJob', sandbox: 'famSandbox', session: 'famSession' }
      const fam = (t) => L(FAM[t] || 'famTool')

      const fmt = (n) => {
        const v = Number(n) || 0
        return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : String(v)
      }
      const clock = (ms) => {
        try { return new Date(ms).toTimeString().slice(0, 8) } catch (e) { return '—' }
      }
      const tokensOf = (e) => (Number(e.input) || 0) + (Number(e.output) || 0) + (Number(e.cache) || 0)

      const CSS = `
.kblg-page{display:flex;flex-direction:column;gap:14px;max-width:100%}
.kblg-lead{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary,#9aa1a8)}
.kblg-priv{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a9096)}
.kblg-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.kblg-card{border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:12px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.03));padding:12px 14px}
.kblg-card b{display:block;font-size:20px;font-weight:650;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#e8eaec)}
.kblg-card span{font-size:12px;color:var(--dsw-alias-label-secondary,#9aa1a8)}
.kblg-card.is-warn b{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kblg-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.kblg-chips{display:flex;flex-wrap:wrap;gap:6px}
.kblg-chip{height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:transparent;color:var(--dsw-alias-label-secondary,#9aa1a8);font:inherit;font-size:12px;cursor:pointer}
.kblg-chip[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary,#4176e6);color:var(--dsw-alias-label-primary,#e8eaec)}
.kblg-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4176e6);outline-offset:1px}
.kblg-in{flex:1;min-width:180px;height:30px;box-sizing:border-box;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.03));color:var(--dsw-alias-label-primary,#e8eaec);font:inherit;font-size:12.5px;padding:0 10px}
.kblg-in:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#4176e6)}
.kblg-btn{height:30px;padding:0 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:transparent;color:var(--dsw-alias-label-primary,#e8eaec);font:inherit;font-size:12.5px;cursor:pointer}
.kblg-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.kblg-btn[aria-pressed="true"]{border-color:var(--dsw-alias-state-success-primary,#22c55e);color:var(--dsw-alias-state-success-primary,#22c55e)}
.kblg-table{width:100%;border-collapse:collapse;font-size:12.5px;table-layout:fixed}
.kblg-table th:nth-child(1),.kblg-table td:nth-child(1){width:78px}
.kblg-table th:nth-child(2),.kblg-table td:nth-child(2){width:104px}
.kblg-table th:nth-child(4),.kblg-table td:nth-child(4){width:86px}
.kblg-table th:nth-child(5),.kblg-table td:nth-child(5){width:78px}
.kblg-table th{text-align:left;font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#8a9096);padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.kblg-table td{padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.05));color:var(--dsw-alias-label-primary,#e8eaec);vertical-align:top;white-space:nowrap}
.kblg-table td:nth-child(3),.kblg-table td:nth-child(6){overflow:hidden;text-overflow:ellipsis}
.kblg-table tr:hover td{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04))}
.kblg-num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.kblg-mut{color:var(--dsw-alias-label-secondary,#9aa1a8)}
.kblg-err{color:var(--dsw-alias-state-error-primary,#ef4444)}
.kblg-warn{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kblg-empty{padding:28px 8px;text-align:center;color:var(--dsw-alias-label-secondary,#9aa1a8);font-size:13px}
/* The Settings volet is ~720 px wide on a desktop viewport, so a viewport media query alone never fires there:
   the page also takes a kblg-narrow class when its own box is narrow (the plate shows that case). */
.kblg-page.kblg-narrow .kblg-table th:nth-child(4),.kblg-page.kblg-narrow .kblg-table td:nth-child(4),
.kblg-page.kblg-narrow .kblg-table th:nth-child(6),.kblg-page.kblg-narrow .kblg-table td:nth-child(6){display:none}
.kblg-page.kblg-narrow .kblg-table th:nth-child(1),.kblg-page.kblg-narrow .kblg-table td:nth-child(1){width:66px}
.kblg-page.kblg-narrow .kblg-table th:nth-child(5),.kblg-page.kblg-narrow .kblg-table td:nth-child(5){width:66px}
@media (max-width:520px){
  .kblg-table th:nth-child(4),.kblg-table td:nth-child(4),
  .kblg-table th:nth-child(6),.kblg-table td:nth-child(6){display:none}
}
`

      // ── the page ────────────────────────────────────────────────────────────────────────────────────────────
      const Page = (props) => {
        const [types, setTypes] = React.useState([])
        const [q, setQ] = React.useState('')
        const [session, setSession] = React.useState('')
        const [live, setLive] = React.useState(false)
        const [events, setEvents] = React.useState([])
        const [stats, setStats] = React.useState([])
        const [state, setState] = React.useState(null)
        const [err, setErr] = React.useState(false)
        const [copied, setCopied] = React.useState(false)

        const load = React.useCallback(async () => {
          try {
            const p = new URLSearchParams({ limit: '300' })
            if (types.length > 0) p.set('types', types.join(','))
            if (q.trim() !== '') p.set('q', q.trim())
            if (session !== '') p.set('session', session)
            const r = await fetch('/kybernos-log/events?' + p.toString())
            const j = await r.json()
            if (j !== null && j.ok === true) { setEvents(Array.isArray(j.events) ? j.events : []); setState(j.state || null); setErr(false) } else setErr(true)
          } catch (e) { setErr(true) }
          try {
            const r = await fetch('/kybernos-log/stats?days=1')
            const j = await r.json()
            if (j !== null && j.ok === true && Array.isArray(j.days)) setStats(j.days)
          } catch (e) { /* the cards keep the last reading */ }
        }, [types.join(','), q, session])

        React.useEffect(() => { load() }, [load])
        React.useEffect(() => {
          const t = setInterval(load, 5000)
          return () => clearInterval(t)
        }, [load])

        // live: the host pushes each new record; the page does not re-read unless the filters change.
        React.useEffect(() => {
          if (!live) return undefined
          let es = null
          try {
            es = new EventSource('/kybernos-log/stream')
            es.addEventListener('record', (ev) => {
              try {
                const rec = JSON.parse(ev.data)
                if (types.length > 0 && !types.includes(rec.type)) return
                if (session !== '' && rec.session !== session) return
                if (q.trim() !== '' && !JSON.stringify(rec).toLowerCase().includes(q.trim().toLowerCase())) return
                setEvents((prev) => {
                  const next = prev.concat([rec])
                  return next.length > 300 ? next.slice(next.length - 300) : next
                })
              } catch (e) { /* a torn frame is skipped */ }
            })
          } catch (e) { return undefined }
          return () => { try { if (es !== null) es.close() } catch (e) { /* closed */ } }
        }, [live, types.join(','), session, q])

        const today = stats[0] || { calls: 0, tokens: 0, types: {}, models: {} }
        const unasked = (today.types.title && today.types.title.calls ? today.types.title.calls : 0) + (today.types.compaction && today.types.compaction.calls ? today.types.compaction.calls : 0) + (today.types.probe && today.types.probe.calls ? today.types.probe.calls : 0)
        const retries = events.filter((e) => e.kind === 'retry').length

        const toggle = (t) => setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : prev.concat([t])))
        const detail = (e) => {
          const bits = []
          if (e.detail !== undefined) bits.push(e.detail)
          else if (e.error !== undefined) bits.push(e.error)
          else if (e.attempt !== undefined) bits.push('#' + e.attempt)
          else if (e.title !== undefined) bits.push(e.title)
          return bits.join(' · ')
        }
        const what = (e) => (e.model !== undefined ? String(e.provider || '') + '/' + String(e.model) : (e.tool || fam(e.type)))
        const copy = async () => {
          try { await navigator.clipboard.writeText(JSON.stringify(events, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch (e) { /* no clipboard */ }
        }

        return h('div', { className: 'kblg-page' },
          h('h2', { style: { margin: 0, fontSize: 17, fontWeight: 650 } }, L('title')),
          h('p', { className: 'kblg-lead' }, L('lead')),
          h('p', { className: 'kblg-priv' }, L('privacy')),
          err ? h('p', { className: 'kblg-err' }, L('unreachable')) : null,
          h('div', { className: 'kblg-cards' },
            h('div', { className: 'kblg-card' }, h('b', null, fmt(today.calls)), h('span', null, L('todayCalls'))),
            h('div', { className: 'kblg-card' }, h('b', null, fmt(today.tokens)), h('span', null, L('todayTokens'))),
            h('div', { className: 'kblg-card is-warn' }, h('b', null, fmt(unasked)), h('span', null, L('hidden'))),
            h('div', { className: 'kblg-card is-warn' }, h('b', null, fmt(retries)), h('span', null, L('retries')))),
          h('div', { className: 'kblg-tools' },
            h('div', { className: 'kblg-chips', role: 'group', 'aria-label': L('filters') },
              TYPES.map((t) => h('button', {
                key: t, type: 'button', className: 'kblg-chip', 'data-family': t,
                'aria-pressed': types.includes(t) ? 'true' : 'false',
                onClick: () => toggle(t)
              }, fam(t)))),
            h('input', { className: 'kblg-in', type: 'search', value: q, placeholder: L('search'), 'aria-label': L('search'), onChange: (e) => setQ(e.target.value) }),
            h('button', { type: 'button', className: 'kblg-btn', 'aria-pressed': live ? 'true' : 'false', onClick: () => setLive(!live) }, live ? L('liveOn') : L('live')),
            h('button', { type: 'button', className: 'kblg-btn', onClick: () => load() }, L('refresh')),
            h('button', { type: 'button', className: 'kblg-btn', onClick: copy }, copied ? L('copied') : L('export'))),
          events.length === 0
            ? h('div', { className: 'kblg-empty' }, L('empty'))
            : h('table', { className: 'kblg-table' },
              h('thead', null, h('tr', null,
                h('th', null, L('colTime')), h('th', null, L('colFamily')), h('th', null, L('colWhat')),
                h('th', null, L('colSession')), h('th', { className: 'kblg-num' }, L('colTokens')), h('th', null, L('colDetail')))),
              h('tbody', null, events.map((e, i) => h('tr', { key: String(e.seq !== undefined ? e.seq : i) },
                h('td', { className: 'kblg-mut' }, clock(e.at)),
                h('td', null, fam(e.type)),
                h('td', null, h('span', { className: e.kind === 'call' || e.kind === 'answer' ? '' : 'kblg-mut' }, what(e))),
                h('td', { className: 'kblg-mut' }, String(e.session || '—').slice(0, 8)),
                h('td', { className: 'kblg-num' }, e.input !== undefined || e.output !== undefined ? fmt(tokensOf(e)) : ''),
                h('td', { className: e.error !== undefined ? 'kblg-err' : (e.kind === 'retry' ? 'kblg-warn' : 'kblg-mut') }, detail(e))))))
        )
      }

      return {
        name: 'kybernos-log',
        inject: ['slots'],
        __test: { S, L, kt, TYPES, FAM, fam, fmt, tokensOf, clock },
        apply (ctx) {
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
      try { console.error('[kybernos-log] load failed — plugin disabled, GUI preserved', error) } catch (e) { /* no console */ }
      return { apply () { /* disabled after a load error */ } }
    }
  }
})
