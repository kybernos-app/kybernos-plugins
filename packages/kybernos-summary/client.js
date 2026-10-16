// kybernos-summary — browser half.
//
// One tab in the right sidebar, « Summary »: what the chat is doing, on one page. Four sections, each folded
// with a click and carrying its count:
//   - Agents             the sub-agents of this chat (projection `subagentCatalog`);
//   - Progress           the agent's task list (projection `todos`, the one the engine shows above the composer);
//   - Execution context  the skills it loaded and the tools it called, MCP servers first (the chat's tool calls);
//   - Files              the files it wrote or edited, a click opens one in the sidebar.
// « Latest only » scopes the last two sections to the current turn (the chat since the last message of the person).
// Agents and Progress always show the current state: a task list and a crew are standing things, not turn things.
//
// No engine patch, nothing is stored or sent: the numbers come from what the engine already holds in the browser.
//   - a probe in the composer dock (slot conversation.composer.dock) reads `useChat` and `useProjection`, the same
//     props the core's usage probe gets, and files them under the session id in a module-level store;
//   - the tab body (slot sidebar.right.pane.tab) reads that store for the chat on screen.
// Loaded through window.__ModuleLoader__.load; the factory RETURNS a plugin object and, on any error, a disabled
// one, so the GUI is preserved.
window.__ModuleLoader__.load({
  id: '@local/kybernos-summary',
  factory (require) {
    try {
      const React = require('react')
      const h = React.createElement

      // ── language: French is the source, English the pair; a translated language is looked up by its French text ──
      const lang = () => {
        try { return String(typeof window.__KB_LANG_RESOLVE__ === 'function' ? window.__KB_LANG_RESOLVE__() : (document.documentElement.lang || 'en')) } catch (e) { return 'en' }
      }
      const kt = (fr, en) => {
        const l = lang()
        if (l === 'kybernos' || l.slice(0, 2) === 'fr') return fr
        if (l === 'en') return en
        try {
          const a = window.__KB_I18N_ACTIVE__
          if (a !== null && a !== undefined && a.dict !== null && typeof a.dict === 'object' && typeof a.dict[fr] === 'string') return a.dict[fr]
        } catch (e) { /* no dictionary: English */ }
        return en
      }
      const fill = (text, p) => (p === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? String(p[k]) : m)))
      // [fr, en] pairs, by key, in ONE table so that a test can check both sides of every pair.
      const S = {
        title: ['Résumé', 'Summary'],
        tabHint: ['Ce que le chat fait : agents, progression, contexte d’exécution et fichiers.', 'What the chat is doing: agents, progress, execution context and files.'],
        latest: ['Dernier tour', 'Latest only'],
        whole: ['Tout le chat', 'Whole chat'],
        latestTip: ['Montrer tout le chat', 'Show the whole chat'],
        wholeTip: ['Ne montrer que le dernier tour', 'Show the latest turn only'],
        agents: ['Agents', 'Agents'],
        progress: ['Progression', 'Progress'],
        context: ['Contexte d’exécution', 'Execution context'],
        skills: ['Compétences', 'Skills'],
        tools: ['MCP et outils', 'MCP & tools'],
        files: ['Fichiers', 'Files'],
        empty: ['Rien à résumer pour l’instant : le travail du chat apparaît ici dès qu’il commence.', 'Nothing to sum up yet: the chat’s work shows up here as soon as it starts.'],
        noChat: ['Ouvre une conversation pour voir son résumé.', 'Open a conversation to see its summary.'],
        more: ['+ {n} autres', '+ {n} more'],
        calls: ['{n} appels', '{n} calls'],
        open: ['Ouvrir {name}', 'Open {name}'],
        modeContinuable: ['en continu', 'ongoing'],
        modeOneShot: ['une fois', 'one-shot'],
        modeExternal: ['externe', 'external'],
        st_pending: ['À faire', 'To do'],
        st_in_progress: ['En cours', 'In progress'],
        st_completed: ['Terminé', 'Done'],
      }
      const L = (key, p) => { const pair = S[key]; return pair === undefined ? key : fill(kt(pair[0], pair[1]), p) }

      // ════════════════════════════════════════════════════════════════════════
      // the model: pure, no DOM, tested without a browser
      // ════════════════════════════════════════════════════════════════════════
      const asObj = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null)
      const parseArgs = (raw) => {
        if (typeof raw !== 'string' || raw === '') return null
        try { return asObj(JSON.parse(raw)) } catch (e) { return null }
      }
      /** One tool call out of a call block, whatever phase it is in: `{ id, name, args }`, or null. */
      const callOf = (block) => {
        const b = asObj(block)
        if (b === null || typeof b.callId !== 'string') return null
        const c = asObj(b.call) || b
        const name = typeof c.name === 'string' && c.name !== '' ? c.name : (typeof b.name === 'string' ? b.name : '')
        if (name === '') return null
        const args = asObj(c.args) || parseArgs(c.argsRaw) || parseArgs(c.arguments) || asObj(b.args) || parseArgs(b.argsRaw) || {}
        return { id: b.callId, name: name, args: args }
      }
      /** Every call block found under a value, nested ones included, bounded so that a huge log cannot stall the page. */
      const findCalls = (value, out, seen, budget, depth) => {
        if (value === null || typeof value !== 'object' || depth > 8 || budget.n <= 0) return
        budget.n -= 1
        if (Array.isArray(value)) { for (const v of value) findCalls(v, out, seen, budget, depth + 1); return }
        const c = callOf(value)
        if (c !== null && !seen.has(c.id)) { seen.add(c.id); out.push(c) }
        for (const k of Object.keys(value)) {
          const v = value[k]
          if (v !== null && typeof v === 'object') findCalls(v, out, seen, budget, depth + 1)
        }
      }
      /** The nodes of the current turn: those from the last message of the person on. The whole list when there is none. */
      const sinceLastUser = (nodes) => {
        for (let i = nodes.length - 1; i >= 0; i -= 1) {
          const n = nodes[i]
          if (n !== null && typeof n === 'object' && n.kind === 'user') return nodes.slice(i)
        }
        return nodes
      }
      const SKILL_TOOL = 'skill'
      const NOT_A_TOOL_ROW = /^(skill|todo_write|ask_user_question|subagent.*)$/
      const FILE_WRITERS = /^(write|edit|multi_edit|notebook_edit|apply_patch)$/
      /** `mcp__github__create_issue` → `{ server: 'github', tool: 'create_issue' }`, or null for a native tool. */
      const splitMcp = (name) => {
        const m = /^mcp__([^_](?:[^_]|_(?!_))*)__(.+)$/.exec(name)
        return m === null ? null : { server: m[1], tool: m[2] }
      }
      /** `web_search` → `Web search`, `exa-search` → `Exa search`. */
      const pretty = (s) => {
        const t = String(s).replace(/[_-]+/g, ' ').trim()
        return t === '' ? String(s) : t.charAt(0).toUpperCase() + t.slice(1)
      }
      const baseName = (p) => { const parts = String(p).replace(/\\/g, '/').split('/').filter((x) => x !== ''); return parts.length > 0 ? parts[parts.length - 1] : String(p) }
      const dirName = (p) => { const parts = String(p).replace(/\\/g, '/').split('/').filter((x) => x !== ''); return parts.length > 1 ? parts.slice(0, -1).join('/') : '' }

      /**
       * The summary of a chat. `data` is what the probe filed: `{ nodes, todos, catalog }`; null before the first one.
       * `latestOnly` scopes skills, tools and files to the current turn.
       */
      const derive = (data, latestOnly) => {
        const out = { agents: [], todos: [], skills: [], tools: [], files: [] }
        if (data === null || data === undefined) return out
        const catalog = Array.isArray(data.catalog) ? data.catalog : []
        for (const e of catalog) {
          const o = asObj(e)
          if (o === null || typeof o.id !== 'string') continue
          const label = typeof o.label === 'string' && o.label.trim() !== '' ? o.label.trim() : ''
          out.agents.push({ id: o.id, label: label !== '' ? label : 'agent ' + o.id.slice(0, 6), mode: typeof o.mode === 'string' ? o.mode : 'unknown' })
        }
        const todos = Array.isArray(data.todos) ? data.todos : []
        for (const t of todos) {
          const o = asObj(t)
          if (o === null || typeof o.content !== 'string' || o.content.trim() === '') continue
          out.todos.push({ content: o.content.trim(), status: o.status === 'completed' || o.status === 'in_progress' ? o.status : 'pending' })
        }
        let nodes = Array.isArray(data.nodes) ? data.nodes : []
        if (latestOnly === true) nodes = sinceLastUser(nodes)
        const calls = []
        const seen = new Set()
        const budget = { n: 20000 }
        for (const n of nodes) findCalls(n, calls, seen, budget, 0)
        const skills = new Map()
        const mcp = new Map()
        const native = new Map()
        const files = new Map()
        for (const c of calls) {
          if (c.name === SKILL_TOOL) {
            const nm = [c.args.name, c.args.skill, c.args.skill_name].find((v) => typeof v === 'string' && v.trim() !== '')
            if (nm !== undefined) skills.set(nm.trim(), (skills.get(nm.trim()) || 0) + 1)
            continue
          }
          if (FILE_WRITERS.test(c.name)) {
            const p = [c.args.file_path, c.args.path, c.args.notebook_path].find((v) => typeof v === 'string' && v.trim() !== '')
            if (p !== undefined) files.set(p, (files.get(p) || 0) + 1)
          }
          const m = splitMcp(c.name)
          if (m !== null) {
            const cur = mcp.get(m.server) || { server: m.server, calls: 0, tools: new Set() }
            cur.calls += 1
            cur.tools.add(m.tool)
            mcp.set(m.server, cur)
            continue
          }
          if (NOT_A_TOOL_ROW.test(c.name)) continue
          native.set(c.name, (native.get(c.name) || 0) + 1)
        }
        for (const [name, n] of skills) out.skills.push({ name: name, calls: n })
        for (const v of mcp.values()) out.tools.push({ kind: 'mcp', id: 'mcp:' + v.server, label: pretty(v.server), calls: v.calls, detail: Array.from(v.tools).join(', ') })
        const nat = Array.from(native.entries()).sort((a, b) => b[1] - a[1])
        for (const [name, n] of nat) out.tools.push({ kind: 'native', id: 'tool:' + name, label: pretty(name), calls: n, detail: name })
        for (const [path, n] of files) out.files.push({ path: path, name: baseName(path), dir: dirName(path), edits: n })
        return out
      }
      const total = (m) => m.agents.length + m.todos.length + m.skills.length + m.tools.length + m.files.length
      /** The address the sidebar opens a file under (the engine's own spelling: `dsh-resource://file/session/<id>/<path>`). */
      const fileAddress = (sessionId, path) => {
        const normalized = String(path).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
        return 'dsh-resource://file/session/' + encodeURIComponent(sessionId) + '/' + normalized.split('/').map(encodeURIComponent).join('/')
      }

      // ════════════════════════════════════════════════════════════════════════
      // the store the probe fills and the tab reads
      // ════════════════════════════════════════════════════════════════════════
      const MAX_SESSIONS = 12
      const store = { bySid: {}, order: [], last: '', subs: new Set() }
      const publish = (sid, data) => {
        if (typeof sid !== 'string' || sid === '') return
        const prev = store.bySid[sid]
        if (prev !== undefined && prev.nodes === data.nodes && prev.todos === data.todos && prev.catalog === data.catalog) { store.last = sid; return }
        store.bySid[sid] = data
        store.last = sid
        const at = store.order.indexOf(sid)
        if (at >= 0) store.order.splice(at, 1)
        store.order.push(sid)
        while (store.order.length > MAX_SESSIONS) delete store.bySid[store.order.shift()]
        for (const f of Array.from(store.subs)) { try { f() } catch (e) { /* a dead listener */ } }
      }
      let CTX = null
      const currentSid = () => {
        try {
          const ui = CTX && CTX.get('uiSession')
          const key = ui && ui.adapter && ui.adapter.current ? ui.adapter.current.getSnapshot().key : ''
          if (typeof key === 'string' && key !== '') return key
        } catch (e) { /* fall back to the last probe */ }
        return store.last
      }
      const PREF_KEY = 'kybernos-summary.latest'
      const readLatest = () => { try { return window.localStorage.getItem(PREF_KEY) !== '0' } catch (e) { return true } }
      const writeLatest = (v) => { try { window.localStorage.setItem(PREF_KEY, v ? '1' : '0') } catch (e) { /* private window */ } }

      // ════════════════════════════════════════════════════════════════════════
      // the probe (renders nothing) and the tab body
      // ════════════════════════════════════════════════════════════════════════
      const Probe = (props) => {
        const p = props !== null && props !== undefined ? props : {}
        const sid = typeof p.sessionId === 'string' ? p.sessionId : ''
        const nodes = typeof p.useChat === 'function' ? p.useChat((c) => { try { return c.nodes.valuesCache } catch (e) { return null } }) : null
        const up = typeof p.useProjection === 'function' ? p.useProjection : null
        const todos = up !== null ? up('todos') : null
        const catalog = up !== null ? up('subagentCatalog') : null
        React.useEffect(() => { publish(sid, { nodes: nodes, todos: todos, catalog: catalog }) }, [sid, nodes, todos, catalog])
        return null
      }

      const Chevron = (props) => h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, style: { transform: props.open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' } },
        h('path', { d: 'M3.5 6l4.5 4.5L12.5 6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      const TodoGlyph = (props) => {
        const s = props.status
        if (s === 'completed') return h('span', { className: 'kbsm-glyph kbsm-done', role: 'img', 'aria-label': L('st_completed') },
          h('svg', { width: 16, height: 16, viewBox: '0 0 16 16' }, h('circle', { cx: 8, cy: 8, r: 8, fill: 'currentColor' }),
            h('path', { d: 'M4.6 8.3l2.3 2.3 4.5-4.7', fill: 'none', stroke: 'var(--dsw-alias-bg-layer-2, #fff)', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' })))
        return h('span', { className: 'kbsm-glyph kbsm-' + (s === 'in_progress' ? 'doing' : 'todo'), role: 'img', 'aria-label': L(s === 'in_progress' ? 'st_in_progress' : 'st_pending') },
          h('svg', { width: 16, height: 16, viewBox: '0 0 16 16' }, h('circle', { cx: 8, cy: 8, r: 6.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }),
            s === 'in_progress' ? h('circle', { cx: 8, cy: 8, r: 3, fill: 'currentColor' }) : null))
      }
      const Icon = (props) => h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true, className: 'kbsm-ico' },
        props.kind === 'file'
          ? h('path', { d: 'M4 1.8h5l3 3V14a.2.2 0 0 1-.2.2H4.2A.2.2 0 0 1 4 14V1.8zM9 1.8V5h3M6 8h4M6 10.5h4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round', strokeLinecap: 'round' })
          : props.kind === 'skill'
            ? h('path', { d: 'M3 13L10.5 5.5M9.2 4.2l2.6 2.6M12 1.5v2.4M10.8 2.7h2.4M3.6 4.4v1.8M2.7 5.3h1.8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' })
            : props.kind === 'agent'
              ? h('g', { fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }, h('circle', { cx: 8, cy: 6, r: 2.4 }), h('path', { d: 'M3.2 13.2c.6-2.4 2.4-3.6 4.8-3.6s4.2 1.2 4.8 3.6', strokeLinecap: 'round' }))
              : h('path', { d: 'M9.8 2.6a3.2 3.2 0 0 0-3.4 4.2L2.5 10.7a1.4 1.4 0 0 0 2 2l3.9-3.9a3.2 3.2 0 0 0 4.2-3.4l-2 2-1.8-.4-.4-1.8z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }))

      const Section = (props) => {
        const open = props.open !== false
        return h('section', { className: 'kbsm-sec', 'data-kb': 'kybernos-summary-section', 'data-sec': props.id },
          h('button', { type: 'button', className: 'kbsm-sec-head', 'aria-expanded': open ? 'true' : 'false', 'data-act': 'toggle-' + props.id, onClick: props.onToggle },
            h('span', { className: 'kbsm-sec-title' }, props.title),
            h('span', { className: 'kbsm-count' }, String(props.count)),
            h('span', { className: 'kbsm-chev' }, h(Chevron, { open: open }))),
          open ? h('div', { className: 'kbsm-sec-body' }, props.children) : null)
      }
      const SubHead = (props) => h('div', { className: 'kbsm-sub' }, h('span', null, props.title), h('span', { className: 'kbsm-count kbsm-count-sub' }, String(props.count)))
      const CAP = 12
      const Capped = (props) => {
        const [all, setAll] = React.useState(false)
        const items = props.items
        const shown = all || items.length <= CAP ? items : items.slice(0, CAP)
        return h(React.Fragment, null, shown.map(props.render),
          items.length > CAP && !all ? h('button', { type: 'button', className: 'kbsm-more', 'data-act': 'more-' + props.id, onClick: () => setAll(true) }, L('more', { n: items.length - CAP })) : null)
      }

      const Pane = () => {
        const [, bump] = React.useState(0)
        const [latest, setLatest] = React.useState(readLatest)
        const [folded, setFolded] = React.useState({})
        React.useEffect(() => {
          const f = () => bump((n) => n + 1)
          store.subs.add(f)
          const t = setInterval(f, 2000)
          return () => { store.subs.delete(f); clearInterval(t) }
        }, [])
        const sid = currentSid()
        const data = sid !== '' && store.bySid[sid] !== undefined ? store.bySid[sid] : null
        const m = React.useMemo(() => derive(data, latest), [data, latest])
        const flip = (id) => setFolded((f) => Object.assign({}, f, { [id]: f[id] !== true }))
        const isOpen = (id) => folded[id] !== true
        const openFile = (path) => {
          try {
            const sb = CTX && CTX.get('sidebarRight')
            if (sb && typeof sb.openResource === 'function' && sid !== '') sb.openResource(fileAddress(sid, path))
          } catch (e) { /* the file stays listed, only the click does nothing */ }
        }
        const head = h('div', { className: 'kbsm-head' },
          h('h2', { className: 'kbsm-h' }, L('title')),
          h('button', { type: 'button', className: 'kbsm-toggle', 'data-act': 'scope', 'aria-pressed': latest ? 'true' : 'false', title: L(latest ? 'latestTip' : 'wholeTip'),
            onClick: () => { const v = !latest; setLatest(v); writeLatest(v) } }, L(latest ? 'latest' : 'whole')))
        const body = sid === '' || data === null
          ? h('p', { className: 'kbsm-empty' }, L(sid === '' ? 'noChat' : 'empty'))
          : (total(m) === 0
            ? h('p', { className: 'kbsm-empty' }, L('empty'))
            : h('div', { className: 'kbsm-card' },
              m.agents.length > 0 ? h(Section, { id: 'agents', title: L('agents'), count: m.agents.length, open: isOpen('agents'), onToggle: () => flip('agents') },
                h(Capped, { id: 'agents', items: m.agents, render: (a) => h('div', { key: a.id, className: 'kbsm-row', 'data-kb': 'kybernos-summary-agent' },
                  h(Icon, { kind: 'agent' }), h('span', { className: 'kbsm-name' }, a.label),
                  a.mode === 'continuable' ? h('span', { className: 'kbsm-tag' }, L('modeContinuable')) : (a.mode === 'one-shot' ? h('span', { className: 'kbsm-tag' }, L('modeOneShot')) : (a.mode === 'external' ? h('span', { className: 'kbsm-tag' }, L('modeExternal')) : null))) })) : null,
              m.todos.length > 0 ? h(Section, { id: 'progress', title: L('progress'), count: m.todos.length, open: isOpen('progress'), onToggle: () => flip('progress') },
                h(Capped, { id: 'progress', items: m.todos, render: (t, i) => h('div', { key: i, className: 'kbsm-row', 'data-kb': 'kybernos-summary-todo', 'data-status': t.status },
                  h(TodoGlyph, { status: t.status }), h('span', { className: 'kbsm-name' + (t.status === 'completed' ? ' kbsm-struck' : '') }, t.content)) })) : null,
              m.skills.length + m.tools.length > 0 ? h(Section, { id: 'context', title: L('context'), count: m.skills.length + m.tools.length, open: isOpen('context'), onToggle: () => flip('context') },
                m.skills.length > 0 ? h(React.Fragment, null, h(SubHead, { title: L('skills'), count: m.skills.length }),
                  h(Capped, { id: 'skills', items: m.skills, render: (s) => h('div', { key: s.name, className: 'kbsm-row', 'data-kb': 'kybernos-summary-skill' }, h(Icon, { kind: 'skill' }), h('span', { className: 'kbsm-name' }, s.name)) })) : null,
                m.tools.length > 0 ? h(React.Fragment, null, h(SubHead, { title: L('tools'), count: m.tools.length }),
                  h(Capped, { id: 'tools', items: m.tools, render: (t) => h('div', { key: t.id, className: 'kbsm-row', 'data-kb': 'kybernos-summary-tool', 'data-tool-kind': t.kind, title: t.detail },
                    h(Icon, { kind: 'tool' }), h('span', { className: 'kbsm-name' }, t.label), t.calls > 1 ? h('span', { className: 'kbsm-tag' }, L('calls', { n: t.calls })) : null) })) : null) : null,
              m.files.length > 0 ? h(Section, { id: 'files', title: L('files'), count: m.files.length, open: isOpen('files'), onToggle: () => flip('files') },
                h(Capped, { id: 'files', items: m.files, render: (f) => h('button', { key: f.path, type: 'button', className: 'kbsm-row kbsm-file', 'data-kb': 'kybernos-summary-file', 'data-path': f.path, title: f.path,
                  'aria-label': L('open', { name: f.name }), onClick: () => openFile(f.path) },
                  h(Icon, { kind: 'file' }), h('span', { className: 'kbsm-name' }, f.name), f.dir !== '' ? h('span', { className: 'kbsm-dir' }, f.dir) : null) })) : null))
        return h('div', { className: 'kbsm', 'data-kb': 'kybernos-summary-pane' }, head, body)
      }

      // ════════════════════════════════════════════════════════════════════════
      // style: DSH tokens with a fallback, never a hard-coded theme colour
      // ════════════════════════════════════════════════════════════════════════
      const CSS = [
        '.kbsm{box-sizing:border-box;height:100%;overflow:auto;padding:10px 12px 20px;color:var(--dsw-alias-label-primary,#222);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.45}',
        '.kbsm-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:2px 2px 10px}',
        '.kbsm-h{margin:0;font-size:16px;font-weight:600}',
        '.kbsm-toggle{border:0;border-radius:9px;padding:6px 12px;cursor:pointer;font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14))}',
        '.kbsm-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.22))}',
        '.kbsm-card{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1));border-radius:14px;padding:4px 12px 8px}',
        '.kbsm-sec+.kbsm-sec{margin-top:2px}',
        '.kbsm-sec-head{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;color:inherit;font:inherit;font-weight:600;padding:12px 2px 8px;cursor:pointer;text-align:left}',
        '.kbsm-sec-title{flex:0 1 auto}',
        '.kbsm-chev{margin-left:auto;display:inline-flex;color:var(--dsw-alias-label-secondary,#666)}',
        '.kbsm-count{font-size:11.5px;font-weight:500;min-width:20px;text-align:center;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#555)}',
        '.kbsm-sub{display:flex;align-items:center;gap:8px;padding:6px 2px 2px;color:var(--dsw-alias-label-secondary,#555)}',
        '.kbsm-count-sub{background:transparent;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3))}',
        '.kbsm-row{display:flex;align-items:center;gap:10px;width:100%;min-height:30px;padding:5px 2px;border:0;background:none;color:inherit;font:inherit;text-align:left;border-radius:8px}',
        '.kbsm-file{cursor:pointer}',
        '.kbsm-file:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}',
        '.kbsm-ico{flex:none;color:var(--dsw-alias-label-secondary,#555)}',
        '.kbsm-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.kbsm-struck{text-decoration:line-through;color:var(--dsw-alias-label-secondary,#666)}',
        '.kbsm-tag,.kbsm-dir{margin-left:auto;flex:none;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#888)}',
        '.kbsm-dir{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;max-width:45%}',
        '.kbsm-glyph{flex:none;display:inline-flex}',
        '.kbsm-done{color:var(--dsw-alias-state-success-primary,#1f6f43)}',
        '.kbsm-doing{color:var(--dsw-alias-brand-primary,#4c6ef5)}',
        '.kbsm-todo{color:var(--dsw-alias-label-tertiary,#999)}',
        '.kbsm-more{border:0;background:none;color:var(--dsw-alias-label-secondary,#555);font:inherit;padding:6px 2px;cursor:pointer}',
        '.kbsm-empty{margin:14px 4px;color:var(--dsw-alias-label-secondary,#666)}',
        '.kbsm-toggle:focus-visible,.kbsm-sec-head:focus-visible,.kbsm-file:focus-visible,.kbsm-more:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c6ef5);outline-offset:1px}',
      ].join('\n')

      const TYPE_ID = 'kybernos-summary'
      const KIND = 'kybernos-summary'
      const SLOT_PANE = 'sidebar.right.pane.tab'
      const STYLE_ID = 'kybernos-summary-styles'

      return {
        name: 'kybernos-summary',
        // `sidebarRightTabs` must be declared: ui-sidebar-right provides it, and without this `apply` could run before.
        inject: ['slots', 'sidebarRightTabs'],
        __test: { S, L, kt, derive, callOf, findCalls, sinceLastUser, splitMcp, pretty, fileAddress, publish, store, total, CSS, TYPE_ID, KIND },
        apply (ctx) {
          CTX = ctx
          ctx.effect(() => {
            if (document.getElementById(STYLE_ID)) return undefined
            const el = document.createElement('style')
            el.id = STYLE_ID
            el.setAttribute('data-plugin', '@local/kybernos-summary')
            el.textContent = CSS
            document.head.appendChild(el)
            return () => { el.remove() }
          }, 'kybernos-summary: styles')

          // the tab type: it shows in the sidebar's « + » guide, and opens like any other tab
          let registre = null
          try { registre = ctx.get('sidebarRightTabs') } catch (e) { registre = null }
          if (registre && typeof registre.register === 'function') {
            ctx.effect(() => registre.register({
              id: TYPE_ID,
              kind: KIND,
              title: () => L('title'),
              guide: [{ title: () => L('title'), description: () => L('tabHint') }],
            }), 'kybernos-summary: sidebar tab type')
          }
          ctx.effect(() => ctx.slots.inject(SLOT_PANE, () => ctx.slots.register(
            { name: SLOT_PANE, key: TYPE_ID },
            () => { try { return h(Pane) } catch (e) { return null } }
          )), 'kybernos-summary: tab body')

          // the probe: renders nothing, files the chat's tool calls, task list and sub-agents under its session id
          ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'kybernos-summary-probe', order: 91 },
            (props) => { try { return h(Probe, props || {}) } catch (e) { return null } }
          )), 'kybernos-summary: probe')

          try {
            window.__KB_SUMMARY__ = {
              /** What the probe filed for the chat on screen: its id and the size of what was read (diagnostics, live checks). */
              state () {
                const sid = currentSid()
                const d = sid !== '' ? store.bySid[sid] : undefined
                const nodes = d !== undefined && Array.isArray(d.nodes) ? d.nodes : null
                return {
                  session: sid,
                  filed: d !== undefined,
                  nodes: nodes === null ? null : nodes.length,
                  kinds: nodes === null ? null : Array.from(new Set(nodes.map((n) => (n !== null && typeof n === 'object' ? String(n.kind) : '?')))),
                  todos: d !== undefined && Array.isArray(d.todos) ? d.todos.length : null,
                  agents: d !== undefined && Array.isArray(d.catalog) ? d.catalog.length : null,
                }
              },
              /** Files `{ nodes, todos, catalog }` under a chat when no model is there to produce them (live checks). It only changes what this page shows. */
              feed (sid, data) {
                const d = asObj(data)
                if (typeof sid !== 'string' || sid === '' || d === null) return false
                publish(sid, { nodes: Array.isArray(d.nodes) ? d.nodes : null, todos: Array.isArray(d.todos) ? d.todos : null, catalog: Array.isArray(d.catalog) ? d.catalog : null })
                return true
              },
              /** Opens the tab, the same call the sidebar's « + » guide makes. False when no chat is on screen. */
              open () {
                try {
                  const sb = CTX && CTX.get('sidebarRight')
                  if (sb && typeof sb.openTab === 'function') { sb.openTab(KIND, {}); return true }
                } catch (e) { /* no chat on screen */ }
                return false
              },
            }
          } catch (e) { /* no window */ }
        },
      }
    } catch (error) {
      try { console.error('[kybernos-summary] load failed — plugin disabled, GUI preserved', error) } catch (e) { /* no console */ }
      return { apply () { /* disabled after a load error */ } }
    }
  },
})
