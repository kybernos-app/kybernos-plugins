// ═══════════════════════════════════════════════════════════════════════════
// kybernos-atlas: client. Settings page "Atlas".
//
// A read-only map of how the things you set up fit together: projects, kybers,
// skills, memory, lessons, automations and apps. It reads routes the other
// Kybernos plugins already serve (same origin, GET, plus two read-only POSTs)
// and the DSH workspace store. It never writes, and keeps nothing between visits.
//
// Two views of the same graph:
//   · Map  : pick a project or a kyber ("Start from"); four columns show who works
//            there, what they use and what they know. Lines follow a hover.
//   · List : every node as a text table, filterable.
// Plus "To check": broken references and things that look wrong, each with the
// reason, and a Help dialog that explains how to read all of it.
//
// Layout of this file:
//   1. pure model   (normalisers for each route, buildGraph, checks, columns)
//   2. loading      (one fetch per source, each allowed to fail on its own)
//   3. interface    (React, no JSX, every class prefixed `kbat-`)
//   4. registration (settings.section, guarded: never stops DSH from starting)
// The pure part is exported as `__test` so test-client.mjs can run it without a
// browser.
// ═══════════════════════════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-atlas/client',
  factory (require) {
    // ══ 1. PURE MODEL ════════════════════════════════════════════════════════
    const DAY = 86400000
    const str = (v) => (typeof v === 'string' ? v : '')
    const low = (v) => str(v).trim().toLowerCase()
    const arr = (v) => (Array.isArray(v) ? v : [])
    const obj = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {})
    const cut = (s, n) => { const t = str(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t }
    const firstSentence = (s) => str(s).replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, '')
    const toMs = (v) => {
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (typeof v === 'string' && v !== '') { const t = Date.parse(v); if (!Number.isNaN(t)) return t }
      return null
    }
    const daysSince = (v, now) => { const t = toMs(v); return t === null ? null : Math.max(0, Math.floor((now - t) / DAY)) }
    const ago = (d) => (d === null ? 'not recorded' : d === 0 ? 'today' : d === 1 ? 'yesterday' : d < 45 ? d + ' days ago' : Math.round(d / 30) + ' months ago')
    const shortId = (id) => (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(id) ? id.slice(0, 8) : id)

    // ── Normalisers: one per route, written against the shapes measured on a
    // running DSH (2026-10). Each tolerates a missing or odd field and never throws.
    function normSkills (j) {
      return arr(obj(j).skills).filter((s) => s !== null && typeof s === 'object' && typeof s.name === 'string' && s.name !== '').map((s) => ({
        name: s.name, description: str(s.description), root: str(s.root), source: str(s.source),
        active: s.active !== false, collision: s.collision === true, modifiedAt: s.modifiedAt === undefined ? null : s.modifiedAt
      }))
    }
    // GET /kybernos/load: kyber definitions (roots[].kybers[]) and workspace names (workspaceUi).
    function normLoad (j) {
      const seen = new Set()
      const kybers = []
      for (const root of arr(obj(j).roots)) {
        for (const k of arr(obj(root).kybers)) {
          const id = low(obj(k).id)
          if (id === '' || seen.has(id)) continue
          seen.add(id)
          const ui = obj(k.ui)
          kybers.push({
            id, name: str(ui.name) !== '' ? str(ui.name) : id, mission: str(k.mission), category: str(ui.category),
            skillsDeclared: arr(k.skillsDeclared).filter((x) => typeof x === 'string' && x !== ''),
            localSkills: arr(k.skills).filter((x) => typeof x === 'string' && x !== ''),
            tools: arr(k.roles).reduce((a, r) => a.concat(arr(obj(r).tools).map((t) => (typeof t === 'string' ? t : str(obj(t).name))).filter((t) => t !== '')), []),
            roles: arr(k.roles).map((r) => str(obj(r).id)).filter((x) => x !== '')
          })
        }
      }
      const ui = {}
      for (const id of Object.keys(obj(obj(j).workspaceUi))) {
        const w = obj(j.workspaceUi[id])
        if (typeof w.name !== 'string') continue
        ui[id] = { name: w.name, skills: arr(w.skills).filter((x) => typeof x === 'string' && x !== '') }
      }
      return { kybers, ui }
    }
    // GET /kybernos-sessions/state: per-kyber ledger (recent lessons, totals, last activity).
    function normState (j) {
      return arr(obj(j).kybers).filter((k) => typeof obj(k).id === 'string').map((k) => ({
        id: low(k.id), total: typeof k.totalLecons === 'number' ? k.totalLecons : arr(k.lecons).length, runs: typeof k.totalRuns === 'number' ? k.totalRuns : 0,
        lastActivity: k.derniereActivite === undefined ? null : k.derniereActivite,
        lessons: arr(k.lecons).map((l) => ({ ts: l.ts === undefined ? null : l.ts, text: str(l.texte), tags: arr(l.tags).filter((t) => typeof t === 'string') })).filter((l) => l.text !== '')
      }))
    }
    // GET /kybernos-cloud/memory: needs a linked account. Account memory can hold hundreds
    // of facts, so it is ONE node with a count, never one node per fact.
    function normMemory (j) {
      const o = obj(j)
      if (o.connected === false) return { connected: false, failed: '', accountCount: 0, pinned: 0, cloud: [], byKyber: {} }
      if (o.ok === false) return { connected: true, failed: str(o.error) !== '' ? str(o.error) : 'read failed', accountCount: 0, pinned: 0, cloud: [], byKyber: {} }
      const byKyber = {}
      for (const id of Object.keys(obj(o.kyber))) {
        const v = o.kyber[id]
        byKyber[low(id)] = Array.isArray(v) ? v.length : typeof v === 'number' ? v : Object.keys(obj(v)).length
      }
      return {
        connected: true, failed: '', accountCount: arr(o.account).length, pinned: arr(o.account).filter((m) => obj(m).pinned === true).length,
        cloud: arr(o.cloud).filter((c) => typeof obj(c).id === 'string').map((c) => ({ id: c.id, name: str(c.name) !== '' ? str(c.name) : c.id, workspaceId: str(c.workspaceId), count: typeof c.memoryCount === 'number' ? c.memoryCount : 0 })),
        byKyber
      }
    }
    // POST /kybernos/tasks {action:'list'}. The raw store also holds each task's prompt and, for webhook
    // tasks, a secret: only the fields below are ever copied, so nothing sensitive reaches the page state.
    const scheduleText = (s) => {
      if (typeof s === 'string') return s
      const o = obj(s)
      if (str(o.cron) !== '') return 'Cron ' + o.cron + (str(o.tz) !== '' ? ' (' + o.tz + ')' : '')
      if (str(o.at) !== '') return 'Once, ' + o.at
      return str(o.mode)
    }
    function normTasks (j) {
      return arr(obj(j).tasks).filter((t) => typeof obj(t).id === 'string').map((t) => ({
        id: t.id, name: str(t.name) !== '' ? str(t.name) : t.id, schedule: scheduleText(t.schedule), active: t.active !== false,
        history: arr(t.history).map((x) => ({ at: x.at === undefined ? null : x.at, sessionId: str(x.sessionId), status: str(x.status), error: cut(x.error, 120) })).sort((a, b) => (toMs(b.at) || 0) - (toMs(a.at) || 0))
      }))
    }
    // Composio connections and mini apps.
    function normApps (conn, mini) {
      const out = []
      for (const c of arr(obj(conn).connections)) {
        if (typeof obj(c).toolkit !== 'string' || arr(c.accounts).length === 0) continue
        out.push({ id: 'toolkit:' + c.toolkit, label: c.toolkit, key: low(c.toolkit), source: 'Composio · ' + c.toolkit, status: str(c.status) })
      }
      for (const m of arr(obj(mini).items)) {
        if (typeof obj(m).id !== 'string') continue
        out.push({ id: 'mini:' + m.id, label: m.id, key: low(m.id), source: str(m.chemin) !== '' ? str(m.chemin) : 'Mini app', status: '' })
      }
      return out
    }
    // Projects: the DSH workspace store (sessions per workspace) merged with workspaceUi (names, skills).
    function normWorkspaces (storeItems, sessionsById, ui) {
      const byId = {}
      for (const it of arr(storeItems)) {
        if (typeof obj(it).workspaceId !== 'string' || it.workspaceId === '') continue
        const sids = arr(it.sessionIds).filter((s) => typeof s === 'string')
        const upd = sids.map((s) => toMs(obj(obj(sessionsById)[s]).updatedAt)).filter((t) => t !== null)
        byId[it.workspaceId] = { id: it.workspaceId, name: str(it.title), sessionIds: sids, updatedAt: upd.length ? Math.max.apply(null, upd) : toMs(it.createdAt), skills: [] }
      }
      const haveStore = Object.keys(byId).length > 0
      for (const id of Object.keys(obj(ui))) {
        if (haveStore && byId[id] === undefined) continue // a workspace that no longer exists
        const w = byId[id] || (byId[id] = { id, name: '', sessionIds: [], updatedAt: null, skills: [] })
        w.name = ui[id].name !== '' ? ui[id].name : w.name
        w.skills = ui[id].skills
      }
      return Object.keys(byId).map((id) => byId[id]).map((w) => Object.assign(w, { name: w.name !== '' ? w.name : shortId(w.id) }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }

    // ── The graph. `src` has one entry per source; null means "not read".
    // Nodes: {id, kind, label, area, days, path, note, deg, problem?}. `area` is a project node id
    // or 'none'. Links: {s, t, kind: 'declared' | 'derived' | 'inferred'}.
    function buildGraph (src, now) {
      const nodes = []; const links = []; const byId = {}; const ghosts = []; const runs = []
      const add = (n) => { n.deg = 0; n.problem = null; nodes.push(n); byId[n.id] = n; return n }
      const link = (s, t, kind) => { if (byId[s] !== undefined && byId[t] !== undefined && s !== t) links.push({ s, t, kind }) }
      const problem = (id, sev, text) => { if (byId[id] !== undefined && (byId[id].problem === null || (byId[id].problem.sev === 'warn' && sev === 'err'))) byId[id].problem = { sev, text } }
      const workspaces = arr(src.workspaces)
      const skills = arr(src.skills)
      const kybers = arr(src.kybers)
      const skillByLow = {}
      for (const s of skills) if (skillByLow[low(s.name)] === undefined) skillByLow[low(s.name)] = s
      const ledger = {}
      for (const k of arr(src.state)) ledger[k.id] = k

      // Projects
      const areas = []
      workspaces.forEach((w, i) => {
        areas.push({ id: 'p:' + w.id, label: w.name, idx: i % 6 })
        add({ id: 'p:' + w.id, kind: 'area', label: w.name, area: 'p:' + w.id, days: daysSince(w.updatedAt, now), path: w.id, note: w.sessionIds.length + (w.sessionIds.length === 1 ? ' session.' : ' sessions.') })
      })
      areas.push({ id: 'none', label: 'Shared or unassigned', idx: 6 })

      // Which project each kyber worked in, from the sessions' active kybers.
      const sessionWs = {}
      for (const w of workspaces) for (const sid of w.sessionIds) sessionWs[sid] = w.id
      const kyberWs = {}
      const activeBySession = obj(src.active)
      for (const sid of Object.keys(activeBySession)) {
        const wid = sessionWs[sid]
        if (wid === undefined) continue
        for (const kid of arr(activeBySession[sid])) { const m = kyberWs[low(kid)] || (kyberWs[low(kid)] = {}); m[wid] = (m[wid] || 0) + 1 }
      }
      const mainWs = (kid) => { const m = obj(kyberWs[kid]); const ids = Object.keys(m).sort((a, b) => m[b] - m[a]); return ids.length ? 'p:' + ids[0] : 'none' }

      // Kybers: definitions (load) merged with the ledger (state). A kyber known only
      // by its ledger is still shown; one with a definition and no ledger too.
      const kyberIds = []
      for (const k of kybers) kyberIds.push(k.id)
      for (const id of Object.keys(ledger)) if (kyberIds.indexOf(id) < 0) kyberIds.push(id)
      const kdef = {}
      for (const k of kybers) kdef[k.id] = k
      for (const kid of kyberIds) {
        const d = kdef[kid]; const l = ledger[kid]
        const bits = []
        if (d && d.mission !== '') bits.push(cut(firstSentence(d.mission), 140) + '.')
        if (d && d.roles.length) bits.push('Roles: ' + d.roles.join(', ') + '.')
        if (l) bits.push(l.total + (l.total === 1 ? ' lesson' : ' lessons') + ', ' + l.runs + (l.runs === 1 ? ' run.' : ' runs.'))
        if (!d) bits.unshift('No kyber definition found; only its lessons and runs remain.')
        add({ id: 'k:' + kid, kind: 'kyber', label: d ? d.name : kid, area: mainWs(kid), days: l ? daysSince(l.lastActivity, now) : null, path: '~/.dsh/kybers/' + kid, note: bits.join(' ') || 'No description.', sub: d ? (d.roles.length ? 'Roles: ' + d.roles.slice(0, 3).join(', ') : '') : 'lessons only' })
        for (const wid of Object.keys(obj(kyberWs[kid]))) link('k:' + kid, 'p:' + wid, 'derived')
      }

      // Skills. Linked by declaration only; a skill nobody declares is NOT a problem (skills are mostly used by name, on demand).
      const declaredBy = {}
      const localOf = {}
      for (const kid of kyberIds) if (kdef[kid]) for (const n of kdef[kid].localSkills) if (localOf[low(n)] === undefined) localOf[low(n)] = { kid, name: n }
      const localNodes = {}
      const declare = (ownerId, name) => {
        const s = skillByLow[low(name)]
        if (s === undefined && localOf[low(name)] !== undefined) {
          // A skill kept inside a kyber's own folder: real, just not in the shared catalogue.
          const lo = localOf[low(name)]; const lid = 's:local:' + lo.kid + ':' + low(lo.name)
          if (localNodes[lid] === undefined) {
            localNodes[lid] = add({ id: lid, kind: 'skill', label: lo.name, area: byId['k:' + lo.kid].area, days: null, path: '~/.dsh/kybers/' + lo.kid + '/skills/' + lo.name, note: 'A skill kept inside the kyber “' + byId['k:' + lo.kid].label + '”, not in the shared catalogue.' })
            link(lid, 'k:' + lo.kid, 'declared')
          }
          if (ownerId !== 'k:' + lo.kid) link(ownerId, lid, 'declared')
          return
        }
        if (s === undefined) { ghosts.push({ id: 'ghost:' + ownerId + ':' + name, src: ownerId, kind: 'skill', label: name, sub: 'Not installed' }); problem(ownerId, 'err', 'Declares the skill “' + name + '”, which is not among your installed skills.'); return }
        ;(declaredBy[low(s.name)] || (declaredBy[low(s.name)] = [])).push(ownerId)
      }
      for (const kid of kyberIds) if (kdef[kid]) for (const name of kdef[kid].skillsDeclared) declare('k:' + kid, name)
      for (const w of workspaces) for (const name of w.skills) declare('p:' + w.id, name)
      const seenSkill = {}
      for (const s of skills) {
        const key = low(s.name)
        if (seenSkill[key]) continue
        seenSkill[key] = true
        const owners = declaredBy[key] || []
        const owner = owners.length ? byId[owners[0]] : null
        add({ id: 's:' + key, kind: 'skill', label: s.name, area: owner ? owner.area : 'none', days: daysSince(s.modifiedAt, now), path: s.root !== '' ? s.root + '/' + s.name : s.name, note: (s.description !== '' ? cut(s.description, 180) : 'No description.') + (s.active ? '' : ' Inactive.') })
        for (const o of owners) link(o, 's:' + key, 'declared')
        if (s.collision) problem('s:' + key, 'warn', 'Another skill has the same name in another folder. Only one of them is used.')
        if (!s.active && owners.length) problem('s:' + key, 'warn', 'Inactive, but declared by ' + owners.map((o) => byId[o].label).join(', ') + '.')
      }

      // Lessons: the ledger keeps the most recent few per kyber; the kyber node says how many exist.
      for (const kid of Object.keys(ledger)) {
        const l = ledger[kid]
        l.lessons.forEach((x, i) => {
          add({ id: 'l:' + kid + ':' + i, kind: 'lesson', label: cut(x.text, 56), area: byId['k:' + kid].area, days: daysSince(x.ts, now), path: '~/.dsh/kybers/' + kid + '/memory/lessons.jsonl', note: x.text + (x.tags.length ? ' Tags: ' + x.tags.join(', ') + '.' : '') })
          link('l:' + kid + ':' + i, 'k:' + kid, 'declared')
        })
        byId['k:' + kid].olderLessons = Math.max(0, l.total - l.lessons.length)
      }

      // Memory. Account memory is one node (it applies to every kyber). Cloud kybers keep a count per workspace.
      const mem = src.memory
      if (mem && mem.connected) {
        add({ id: 'm:account', kind: 'memory', label: 'Account memory', area: 'none', days: null, path: 'kybernos.app · account', note: mem.accountCount + ' facts kept in your account' + (mem.pinned ? ', ' + mem.pinned + ' pinned' : '') + '. They apply to every kyber, so they are not drawn one by one.' })
        for (const c of mem.cloud) {
          add({ id: 'm:cloud:' + c.id, kind: 'memory', label: c.name + ' memory', area: workspaces.some((w) => w.id === c.workspaceId) ? 'p:' + c.workspaceId : 'none', days: null, path: 'kybernos.app · ' + c.name, note: c.count + (c.count === 1 ? ' fact' : ' facts') + ' kept for “' + c.name + '”.' })
          link('m:cloud:' + c.id, 'p:' + c.workspaceId, 'declared')
        }
        for (const kid of Object.keys(mem.byKyber)) {
          if (byId['k:' + kid] === undefined || mem.byKyber[kid] === 0) continue
          add({ id: 'm:kyber:' + kid, kind: 'memory', label: byId['k:' + kid].label + ' memory', area: byId['k:' + kid].area, days: null, path: 'kybernos.app · kyber ' + kid, note: mem.byKyber[kid] + ' facts kept for this kyber.' })
          link('m:kyber:' + kid, 'k:' + kid, 'declared')
        }
      }

      // Automations: a task is tied to a project through the sessions its runs opened.
      for (const t of arr(src.tasks)) {
        const hist = t.history
        const wsCount = {}
        for (const x of hist) { const w = sessionWs[x.sessionId]; if (w !== undefined) wsCount[w] = (wsCount[w] || 0) + 1 }
        const wid = Object.keys(wsCount).sort((a, b) => wsCount[b] - wsCount[a])[0]
        const last = hist[0]
        const failed = last !== undefined && last.status === 'error'
        const lastTxt = last ? 'Last run ' + ago(daysSince(last.at, now)) + (failed ? ' failed.' : '.') : 'No run recorded yet.'
        add({ id: 't:' + t.id, kind: 'routine', label: t.name, area: wid !== undefined ? 'p:' + wid : 'none', days: last ? daysSince(last.at, now) : null, path: '~/.dsh/kybernos/tasks.json › ' + t.id, note: (t.schedule !== '' ? t.schedule + '. ' : '') + (t.active ? '' : 'Paused. ') + lastTxt, sub: (last ? 'last run ' + ago(daysSince(last.at, now)) + (failed ? ', failed' : '') : 'never ran') + (t.active ? '' : ' · paused') })
        if (wid !== undefined) link('t:' + t.id, 'p:' + wid, 'derived')
        hist.slice(0, 20).forEach((x, i) => { const d = daysSince(x.at, now); if (d !== null && d <= 13) runs.push({ id: 'x:' + t.id + ':' + i, task: 't:' + t.id, taskName: t.name, days: d, ok: x.status !== 'error', status: x.status, error: x.error, sessionId: x.sessionId }) })
        if (failed && t.active) problem('t:' + t.id, 'warn', 'The last run failed' + (last.error !== '' ? ': ' + last.error : '.') + (last.error !== '' && !/[.!?]$/.test(last.error) ? '.' : ''))
      }

      // Apps. An app is tied to a kyber only by a name match on the kyber's tools: inferred, drawn dashed.
      for (const a of arr(src.apps)) {
        const users = kyberIds.filter((kid) => kdef[kid] && kdef[kid].tools.some((t) => a.key !== '' && low(t).indexOf(a.key) >= 0))
        add({ id: 'a:' + a.id, kind: 'app', label: a.label, area: users.length ? byId['k:' + users[0]].area : 'none', days: null, path: a.source, note: 'Connected' + (a.status !== '' ? ' (' + low(a.status) + ')' : '') + '.' })
        for (const kid of users) link('a:' + a.id, 'k:' + kid, 'inferred')
      }

      const adj = {}
      for (const n of nodes) adj[n.id] = new Set()
      for (const l of links) { adj[l.s].add(l.t); adj[l.t].add(l.s) }
      for (const n of nodes) n.deg = adj[n.id].size
      const problems = nodes.filter((n) => n.problem !== null).sort((a, b) => (a.problem.sev === 'err' ? 0 : 1) - (b.problem.sev === 'err' ? 0 : 1) || a.label.localeCompare(b.label))
      const ghostsOf = (id) => ghosts.filter((g) => g.src === id)
      return { nodes, links, byId, adj, areas, ghosts, ghostsOf, problems, runs, now, memory: mem && mem.connected ? { accountCount: mem.accountCount } : null }
    }

    // The node a kind of thing "belongs to" for the Map view: a project or a kyber.
    function hubOf (g, n) {
      if (n.kind === 'area' || n.kind === 'kyber') return n.id
      const nb = Array.from(g.adj[n.id] || []).map((i) => g.byId[i])
      const k = nb.filter((x) => x.kind === 'kyber')[0]; if (k) return k.id
      const a = nb.filter((x) => x.kind === 'area')[0]; if (a) return a.id
      return null
    }
    // The nodes drawn around a hub: for a project, its kybers and what those kybers use; for a kyber, its projects and what it uses.
    function aroundSet (g, focusId) {
      const set = new Set([focusId])
      const keep = (id) => g.byId[id] !== undefined
      const near = (id) => Array.from(g.adj[id] || []).filter(keep)
      near(focusId).forEach((i) => set.add(i))
      if (g.byId[focusId] && g.byId[focusId].kind === 'area') near(focusId).filter((i) => g.byId[i].kind === 'kyber').forEach((k) => near(k).forEach((i) => { if (g.byId[i].kind !== 'area') set.add(i) }))
      return set
    }
    const COLS = [
      { title: 'Project', groups: [['area', '']] },
      { title: 'Kybers & automations', groups: [['kyber', 'Kybers'], ['routine', 'Automations']] },
      { title: 'Skills & apps', groups: [['skill', 'Skills'], ['app', 'Apps']] },
      { title: 'Memory & lessons', groups: [['memory', 'Memory'], ['lesson', 'Lessons']] }
    ]
    const COL_OF = { area: 0, kyber: 1, routine: 1, skill: 2, app: 2, memory: 3, lesson: 3 }
    const KIND_NAME = { area: 'Project', kyber: 'Kyber', routine: 'Automation', skill: 'Skill', app: 'App', memory: 'Memory', lesson: 'Lesson' }
    const KIND_ORDER = ['area', 'kyber', 'routine', 'skill', 'app', 'memory', 'lesson']
    const byKindThenLabel = (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.label.localeCompare(b.label)
    const CAP = 5
    // What the Map view draws: columns of groups, and the lines between the pills.
    function aroundModel (g, focusId, expanded) {
      const f = g.byId[focusId]
      if (f === undefined) return null
      const set = aroundSet(g, focusId)
      const ghosts = []
      set.forEach((id) => g.ghostsOf(id).forEach((x) => ghosts.push(x)))
      const lines = g.links.filter((l) => set.has(l.s) && set.has(l.t)).map((l) => ({ s: l.s, t: l.t, inferred: l.kind === 'inferred' }))
      ghosts.forEach((x) => lines.push({ s: x.src, t: x.id, inferred: false }))
      const cols = COLS.map((c, ci) => ({
        title: ci === 0 && f.kind === 'kyber' ? 'Projects' : c.title,
        groups: c.groups.map((gr) => {
          const items = g.nodes.filter((n) => set.has(n.id) && n.kind === gr[0]).sort(byKindThenLabel)
          const gh = ghosts.filter((x) => x.kind === gr[0])
          const key = focusId + '/' + gr[0]
          const open = expanded[key] === true
          return { key, label: gr[1], kind: gr[0], total: items.length + gh.length, items: open ? items : items.slice(0, CAP), hidden: items.length > CAP ? items.length - CAP : 0, open, ghosts: gh }
        })
      }))
      return { focus: f, cols, lines }
    }
    const listRows = (g, filter) => {
      const q = low(filter)
      return g.nodes.filter((n) => q === '' || (n.label + ' ' + n.note + ' ' + n.path).toLowerCase().indexOf(q) >= 0)
        .sort((a, b) => (b.problem !== null) - (a.problem !== null) || byKindThenLabel(a, b))
    }
    const pickerItems = (g, query) => {
      const q = low(query)
      if (q !== '') return g.nodes.filter((n) => (n.label + ' ' + n.note).toLowerCase().indexOf(q) >= 0).sort(byKindThenLabel).slice(0, 12).map((n) => ({ id: n.id, label: n.label, sub: KIND_NAME[n.kind] }))
      const out = []
      const proj = g.nodes.filter((n) => n.kind === 'area'); const ky = g.nodes.filter((n) => n.kind === 'kyber')
      if (proj.length) { out.push({ head: 'Projects' }); proj.forEach((n) => out.push({ id: n.id, label: n.label, sub: n.deg + ' links' })) }
      if (ky.length) { out.push({ head: 'Kybers' }); ky.sort((a, b) => a.label.localeCompare(b.label)).forEach((n) => out.push({ id: n.id, label: n.label, sub: n.deg + ' links' })) }
      return out
    }
    // Where the Map opens: the project or kyber with the most links, so the first view is never empty
    // when something is connected. Ties go to the most recently active, then to the name.
    const defaultFocus = (g) => {
      const hubs = g.nodes.filter((n) => n.kind === 'area' || n.kind === 'kyber')
      hubs.sort((a, b) => b.deg - a.deg || (a.days === null ? 1e9 : a.days) - (b.days === null ? 1e9 : b.days) || a.label.localeCompare(b.label))
      return hubs.length ? hubs[0].id : null
    }


    // ── The whole-workspace views: Rings, Circle, Areas, Links, Timeline, Orbit ──
    // The same nodes and links as the Around view, drawn on one canvas. This part is pure: it builds the
    // canvas model (a copy of the graph plus a root, the recent automation runs and the broken-link stubs)
    // and every layout, so test-client.mjs can check them without a browser.
    const CANVAS_VIEWS = ['rings', 'circle', 'areas', 'links', 'timeline', 'orbit']
    const LAYERS = ['core', 'projects', 'kybers', 'knowledge', 'skills', 'automations', 'apps', 'runs']
    const LAYER_NAME = { core: 'Workspace', projects: 'Projects', kybers: 'Kybers', knowledge: 'Memory & lessons', skills: 'Skills', automations: 'Automations', apps: 'Apps', runs: 'Runs' }
    const LAYER_OF = { root: 'core', area: 'projects', kyber: 'kybers', memory: 'knowledge', lesson: 'knowledge', skill: 'skills', routine: 'automations', app: 'apps', run: 'runs' }
    const KIND_NAME_ALL = Object.assign({ root: 'Workspace', run: 'Run' }, KIND_NAME)
    const RING_R = [0, 125, 210, 295, 380, 460, 530, 600]
    const TL = { lanes: ['root', 'area', 'kyber', 'memory', 'lesson', 'skill', 'routine', 'app'], x0: -410, x1: 520, nod: -478 }
    const tlx = (d) => TL.x1 - Math.sqrt(Math.min(d, 220) / 220) * (TL.x1 - TL.x0)
    const hashOf = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) } return ((x >>> 0) % 10000) / 10000 }
    const shortDate = (d, now) => new Date(now - d * DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

    // Nodes are COPIES (the engine moves them); `root` and `run` nodes exist only here. Lessons are left out
    // unless asked for: there are many of them and they bury everything else on a whole-workspace picture.
    function canvasModel (g, opts) {
      const withLessons = !!(opts && opts.lessons)
      const now = typeof g.now === 'number' ? g.now : Date.now()
      const nodes = []; const byId = {}
      const add = (n) => { n.h = hashOf(n.id); n.layer = LAYER_OF[n.kind]; n.x = 0; n.y = 0; n.tx = 0; n.ty = 0; n.ds = 1; n.z = 0; n.deg = 0; nodes.push(n); byId[n.id] = n; return n }
      add({ id: 'root', kind: 'root', label: 'Workspace', area: null, days: 0, path: '~/.dsh', note: 'Everything here is read live from your own files and plugins.', problem: null })
      for (const n of g.nodes) { if (n.kind === 'lesson' && !withLessons) continue; add(Object.assign({}, n)) }
      for (const r of arr(g.runs)) {
        const t = g.byId[r.task]
        add({ id: r.id, kind: 'run', label: r.taskName + ' · ' + shortDate(r.days, now), area: t ? t.area : 'none', days: r.days, path: r.sessionId !== '' ? 'session ' + r.sessionId : 'task history',
          note: (r.ok ? 'Ran ' + ago(r.days) + '.' : 'Failed ' + ago(r.days) + (r.error !== '' ? ': ' + r.error : '.')), problem: null, run: { ok: r.ok } })
      }
      const links = []
      const has = (id) => byId[id] !== undefined
      for (const l of g.links) if (has(l.s) && has(l.t)) links.push({ s: l.s, t: l.t, inf: l.kind === 'inferred', bad: false })
      for (const a of g.areas) if (a.id !== 'none' && has(a.id)) links.push({ s: a.id, t: 'root', inf: false, bad: false })
      if (has('m:account')) links.push({ s: 'm:account', t: 'root', inf: false, bad: false })
      for (const r of arr(g.runs)) if (has(r.task)) links.push({ s: r.id, t: r.task, inf: false, bad: false })
      for (const x of g.ghosts) if (has(x.src)) links.push({ s: x.src, t: null, inf: false, bad: true })
      const adj = {}
      for (const n of nodes) adj[n.id] = new Set()
      for (const l of links) { if (l.bad) continue; adj[l.s].add(l.t); adj[l.t].add(l.s) }
      for (const n of nodes) n.deg = adj[n.id].size
      const areaCount = {}; const areaIdx = {}
      for (const a of g.areas) { areaCount[a.id] = 0; areaIdx[a.id] = a.idx }
      const kindCount = {}
      for (const n of nodes) { if (n.area !== null && areaCount[n.area] !== undefined) areaCount[n.area] += 1; kindCount[n.kind] = (kindCount[n.kind] || 0) + 1 }
      return { nodes, byId, adj, links, areas: g.areas, areaCount, areaIdx, kindCount, problemCount: nodes.filter((n) => n.problem !== null).length, hasRuns: arr(g.runs).length > 0, now }
    }

    // A small force simulation, run once up front so the layout is stable (same result every time).
    function runForce (list, lnks, start) {
      const out = {}
      const P = list.map((n) => { const p = start[n.id] || [0, 0]; return { n, x: p[0] * 0.8 + (n.h - 0.5) * 20, y: p[1] * 0.8 + (hashOf(n.id + 'y') - 0.5) * 20, vx: 0, vy: 0 } })
      const idx = {}
      P.forEach((p, i) => { idx[p.n.id] = i })
      const E = lnks.filter((l) => !l.bad && idx[l.s] !== undefined && idx[l.t] !== undefined).map((l) => [idx[l.s], idx[l.t]])
      for (let it = 0; it < 420; it++) {
        const al = 1 - it / 420
        for (let i = 0; i < P.length; i++) {
          for (let j = i + 1; j < P.length; j++) {
            const dx = P[j].x - P[i].x; const dy = P[j].y - P[i].y; const d2 = dx * dx + dy * dy + 0.01; const d = Math.sqrt(d2); const f = 2600 * al / d2
            const fx = dx / d * f; const fy = dy / d * f
            P[i].vx -= fx; P[i].vy -= fy; P[j].vx += fx; P[j].vy += fy
          }
        }
        for (const e of E) {
          const a = P[e[0]]; const b = P[e[1]]; const dx = b.x - a.x; const dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) + 0.01; const f = (d - 62) * 0.06
          a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f
        }
        for (const p of P) { p.vx -= p.x * 0.012; p.vy -= p.y * 0.012; p.x += p.vx * 0.6; p.y += p.vy * 0.6; p.vx *= 0.55; p.vy *= 0.55 }
      }
      for (const p of P) out[p.n.id] = [p.x, p.y]
      return out
    }

    // Every position of every view, plus the 3D coordinates of Orbit and the guides (halos, boxes).
    function canvasLayouts (m) {
      const nodes = m.nodes; const areas = m.areas
      const ordered = (list) => list.slice().sort(byKindThenLabel)
      // A wedge is as wide as what the project holds, plus a floor so that a project with one thing is still visible.
      const weight = (ar) => (m.areaCount[ar.id] || 0) + 3
      let total = 0
      for (const a of areas) total += weight(a)
      const wedge = {}
      let a0 = -Math.PI / 2
      for (const ar of areas) { const span = 2 * Math.PI * weight(ar) / total; wedge[ar.id] = [a0, a0 + span]; a0 += span }
      const rings = { root: [0, 0] }; const L3 = { root: [0, -245, 0] }
      const LV = [-245, -175, -105, -35, 35, 105, 175, 245]; const RR = [0, 200, 240, 265, 290, 300, 300, 310]
      for (const ar of areas) {
        LAYERS.forEach((ly, li) => {
          if (li === 0) return
          const list = ordered(nodes.filter((n) => n.area === ar.id && n.layer === ly))
          if (!list.length) return
          const w = wedge[ar.id]; const pad = (w[1] - w[0]) * 0.04
          list.forEach((n, i) => {
            const a = w[0] + pad + (i + 0.5) / list.length * (w[1] - w[0] - 2 * pad)
            rings[n.id] = [Math.cos(a) * RING_R[li], Math.sin(a) * RING_R[li]]
            const r = RR[li] + (n.h - 0.5) * 30
            L3[n.id] = [Math.cos(a) * r, LV[li] + (n.h - 0.5) * 26, Math.sin(a) * r]
          })
        })
      }
      const circle = { root: [0, 0] }
      let all = []
      for (const ar of areas) all = all.concat(ordered(nodes.filter((n) => n.area === ar.id)))
      all.forEach((n, i) => { const a = -Math.PI / 2 + i / all.length * 2 * Math.PI; circle[n.id] = [Math.cos(a) * 330, Math.sin(a) * 330] })
      // Areas: one cluster per project, sized by what it holds and spread so that clusters do not overlap.
      const clusters = { root: [0, 0] }; const halos = {}
      const rc = areas.map((ar) => 27 * Math.sqrt((m.areaCount[ar.id] || 0) + 1.4) + 16)
      const span = rc.map((r) => 2 * r + 36)
      const spanTotal = span.reduce((s, x) => s + x, 0)
      const D = Math.max(360, spanTotal / (2 * Math.PI))
      let acc = 0
      areas.forEach((ar, j) => {
        const a = -Math.PI / 2 + (acc + span[j] / 2) / spanTotal * 2 * Math.PI; acc += span[j]
        const cx = Math.cos(a) * D; const cy = Math.sin(a) * D
        halos[ar.id] = { x: cx, y: cy, r: rc[j] }
        if (m.byId[ar.id] !== undefined) clusters[ar.id] = [cx, cy]
        ordered(nodes.filter((n) => n.area === ar.id && n.kind !== 'area')).forEach((n, i) => { const r = 27 * Math.sqrt(i + 1.4); const t = i * 2.39996 + j * 1.3; clusters[n.id] = [cx + Math.cos(t) * r, cy + Math.sin(t) * r] })
      })
      const links = runForce(nodes, m.links, clusters)
      // Timeline: automation runs by day on top, everything else by last change below (square-root scale so
      // recent changes do not pile up). Things with no recorded date sit in their own column.
      const timeline = {}; const perDay = {}
      for (const n of nodes) {
        if (n.kind === 'run') { const c = perDay[n.days] = (perDay[n.days] || 0) + 1; timeline[n.id] = [TL.x1 - n.days * ((TL.x1 - TL.x0) / 13), -58 - (c - 1) * 17] } else {
          const lane = Math.max(0, TL.lanes.indexOf(n.kind))
          timeline[n.id] = [n.days === null ? TL.nod + (n.h - 0.5) * 26 : tlx(n.days), 100 + lane * 34 + (n.h - 0.5) * 14]
        }
      }
      const boxOf = (pos, rects) => {
        let a = 1e9; let b = 1e9; let c = -1e9; let d = -1e9
        for (const id of Object.keys(pos)) { a = Math.min(a, pos[id][0]); b = Math.min(b, pos[id][1]); c = Math.max(c, pos[id][0]); d = Math.max(d, pos[id][1]) }
        for (const r of rects || []) { a = Math.min(a, r.x - r.r); b = Math.min(b, r.y - r.r); c = Math.max(c, r.x + r.r); d = Math.max(d, r.y + r.r) }
        return a > c ? [-100, -100, 100, 100] : [a - 20, b - 20, c + 60, d + 20]
      }
      const boxes = { rings: [-660, -660, 660, 660], circle: [-390, -390, 390, 390], timeline: [-575, -340, 540, 340], orbit: [-400, -330, 400, 330], areas: boxOf(clusters, Object.keys(halos).map((k) => halos[k])), links: boxOf(links) }
      return { rings, circle, areas: clusters, links, timeline, L3, halos, boxes }
    }

    // ══ 2. LOADING ═══════════════════════════════════════════════════════════
    const SOURCES = [['projects', 'Projects'], ['kybers', 'Kybers'], ['skills', 'Skills'], ['lessons', 'Lessons'], ['memory', 'Memory (cloud)'], ['automations', 'Automations'], ['apps', 'Apps']]
    const TIMEOUT = 15000
    async function getJson (url, init) {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null
      const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT) : null
      try {
        const res = await fetch(url, Object.assign({ signal: ctl ? ctl.signal : undefined }, init || {}))
        if (!res.ok) throw new Error('HTTP ' + res.status)
        return await res.json()
      } finally { if (timer) clearTimeout(timer) }
    }
    const postJson = (url, body) => getJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    // Reads every source on its own: one that fails is reported and the rest still draw.
    // `store` is the DSH workspace store ({ workspaces, sessions }) or null.
    async function readAll (store, onStatus) {
      const status = {}
      const set = (key, state, count, note) => { status[key] = { state, count: count === undefined ? null : count, note: note || '' }; try { onStatus(Object.assign({}, status)) } catch (e) { /* the UI went away */ } }
      for (const s of SOURCES) set(s[0], 'waiting')
      const src = { workspaces: null, kybers: null, skills: null, state: null, memory: null, tasks: null, apps: null, active: {} }
      const run = (key, work) => { set(key, 'reading'); return work().then((n) => { if (status[key].state === 'reading') set(key, 'ok', n) }, (e) => set(key, 'failed', null, String(e && e.message ? e.message : e))) }
      let load = null
      const pLoad = getJson('/kybernos/load').then((j) => { load = normLoad(j); return load })
      await Promise.all([
        run('kybers', async () => { const l = await pLoad; src.kybers = l.kybers; return l.kybers.length }),
        run('projects', async () => {
          const l = await pLoad
          const snap = (c) => { try { return c.getSnapshot() } catch (e) { return null } }
          const wl = store && store.workspaces && store.workspaces.list ? snap(store.workspaces.list) : null
          const sl = store && store.sessions && store.sessions.list ? snap(store.sessions.list) : null
          // The store is only trustworthy once it says so; before that we keep the names and skills from workspaceUi.
          const ready = wl !== null && (wl.phase === undefined || wl.phase === 'ready')
          src.storeReady = ready
          src.workspaces = normWorkspaces(ready ? wl.items : [], sl ? sl.byId : {}, l.ui)
          // Which kybers were active in each project's recent sessions. Read-only, at most 40 sessions per
          // call, and three projects at a time: the host also reads transcripts for each call.
          const todo = src.workspaces.filter((w) => w.sessionIds.length > 0)
          const upd = (sid) => toMs(obj(obj(sl && sl.byId)[sid]).updatedAt) || 0
          let next = 0
          const worker = async () => {
            while (next < todo.length) {
              const w = todo[next++]
              try { const r = await postJson('/kybernos/project-data', { sessionIds: w.sessionIds.slice().sort((a, b) => upd(b) - upd(a)).slice(0, 40) }); Object.assign(src.active, obj(obj(r).active)) } catch (e) { /* this project simply has no kyber links */ }
            }
          }
          await Promise.all([worker(), worker(), worker()])
          return src.workspaces.length
        }),
        run('skills', async () => { src.skills = normSkills(await getJson('/kybernos-skills/skills')); return src.skills.length }),
        run('lessons', async () => { src.state = normState(await getJson('/kybernos-sessions/state')); return src.state.reduce((n, k) => n + k.lessons.length, 0) }),
        run('memory', async () => {
          src.memory = normMemory(await getJson('/kybernos-cloud/memory'))
          if (src.memory.failed !== '') throw new Error(src.memory.failed)
          if (!src.memory.connected) { set('memory', 'skipped', null, 'Account not linked'); return 0 }
          return src.memory.accountCount
        }),
        run('automations', async () => { src.tasks = normTasks(await postJson('/kybernos/tasks', { action: 'list' })); return src.tasks.length }),
        run('apps', async () => {
          let [c, m] = await Promise.all([getJson('/kybernos/composio/connections').catch(() => null), getJson('/kybernos-miniapps/list').catch(() => null)])
          if (c !== null && c.ok === false) c = null // Composio not set up: its apps are simply absent
          if (c === null && m === null) throw new Error('no answer')
          src.apps = normApps(c, m); return src.apps.length
        })
      ])
      return { src, status }
    }


    // ══ 2b. CANVAS ENGINE ════════════════════════════════════════════════════
    // Draws a canvas model with one of the six layouts. The state lives in a plain object (`e`), never in
    // React state: a frame must not trigger a render. React only passes the latest props in `e.props`
    // (selection, filters, toggles) and calls the helpers below.
    const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const clampN = (v, a, b) => Math.max(a, Math.min(b, v))
    function newEngine () {
      return { W: 0, H: 0, DPR: 1, cam: { x: 0, y: 0, k: 1 }, camT: { x: 0, y: 0, k: 1 }, follow: null, rot: 0, tilt: 0.42, hover: null, drag: null, dirty: true, colors: null, cw: {}, model: null, lay: null, view: 'rings', ctx: null, cv: null, props: {}, last: 0 }
    }
    function engColors (e, el) {
      let cs = null
      try { cs = getComputedStyle(el) } catch (x) { return }
      const g = (n) => cs.getPropertyValue(n).trim()
      e.colors = {
        bg: g('--dsw-alias-bg-layer-1') || '#fff', ink: g('--dsw-alias-label-primary') || '#111', ink2: g('--dsw-alias-label-secondary') || '#555', ink3: g('--dsw-alias-label-tertiary') || '#888',
        line1: g('--dsw-alias-border-l1') || '#0000000a', err: g('--dsw-alias-state-error-primary') || '#ec1313', warn: g('--dsw-alias-state-warn-primary') || '#f59e0b',
        areas: [0, 1, 2, 3, 4, 5, 6].map((i) => g('--kbat-p' + i) || '#888'), font: cs.fontFamily || 'sans-serif'
      }
      e.cw = {}; e.dirty = true
    }
    const engColorOf = (e, n) => { if (n.kind === 'root') return e.colors.ink; const i = e.model.areaIdx[n.area]; return e.colors.areas[i === undefined ? 6 : i] }
    const engRad = (n) => (n.kind === 'root' ? 11 : n.kind === 'run' ? 3.6 : clampN(4 + 1.5 * Math.sqrt(n.deg), 4, 12) + (n.kind === 'area' ? 2 : 0))
    const engOrbitScale = (n) => clampN(n.ds * 1.15, 0.6, 1.5)
    function engMatch (e, n) {
      const f = e.props.iso
      if (f) { if (f.k === 'area' && n.area !== f.v) return false; if (f.k === 'kind' && n.kind !== f.v) return false; if (f.k === 'problem' && n.problem === null) return false }
      if (e.props.query && (n.label + ' ' + n.path + ' ' + n.note).toLowerCase().indexOf(e.props.query) < 0) return false
      return true
    }
    function engOrbit (e, t) {
      const ang = e.rot + (e.props.motion ? t * 0.00006 : 0); const ca = Math.cos(ang); const sa = Math.sin(ang); const ct = Math.cos(e.tilt); const st = Math.sin(e.tilt); const F = 900
      for (const n of e.model.nodes) {
        const p = e.lay.L3[n.id]; if (!p) continue
        const x1 = p[0] * ca + p[2] * sa; const z1 = -p[0] * sa + p[2] * ca; const y2 = p[1] * ct - z1 * st; const z2 = p[1] * st + z1 * ct; const s = F / (F + z2 + 120)
        n.tx = x1 * s; n.ty = y2 * s; n.ds = s; n.z = z2
      }
    }
    function engTargets (e, t) {
      if (!e.model || !e.lay) return
      if (e.view === 'orbit') { engOrbit(e, t); return }
      const pos = e.lay[e.view]; if (!pos) return
      for (const n of e.model.nodes) { const p = pos[n.id]; if (p) { n.tx = p[0]; n.ty = p[1] } n.ds = 1 }
    }
    function engFit (e, instant) {
      if (!e.W || !e.lay) return
      e.follow = null
      const bb = e.lay.boxes[e.view] || [-300, -300, 300, 300]; const bw = bb[2] - bb[0]; const bh = bb[3] - bb[1]; const m = e.W < 520 ? 24 : 56
      e.camT.k = clampN(Math.min((e.W - m * 2) / bw, (e.H - m * 2) / bh), 0.18, 2.6); e.camT.x = (bb[0] + bb[2]) / 2; e.camT.y = (bb[1] + bb[3]) / 2
      if (instant) { e.cam.k = e.camT.k; e.cam.x = e.camT.x; e.cam.y = e.camT.y }
      e.dirty = true
    }
    function engZoom (e, f, mx, my) {
      const k0 = e.camT.k; const k1 = clampN(k0 * f, 0.18, 4); const x = mx === undefined ? e.W / 2 : mx; const y = my === undefined ? e.H / 2 : my
      const wx = (x - e.W / 2) / k0 + e.camT.x; const wy = (y - e.H / 2) / k0 + e.camT.y
      e.camT.k = k1; e.camT.x = wx - (x - e.W / 2) / k1; e.camT.y = wy - (y - e.H / 2) / k1; e.follow = null; e.dirty = true
    }
    function engFly (e, id, k) { if (!e.model || !e.model.byId[id]) return; e.follow = id; e.camT.k = Math.max(e.camT.k, k || 1.5); e.dirty = true }
    function engSize (e, w, hgt) {
      if (!e.cv || !w || !hgt) return
      e.DPR = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2); e.W = w; e.H = hgt
      e.cv.width = Math.round(w * e.DPR); e.cv.height = Math.round(hgt * e.DPR); e.cv.style.width = w + 'px'; e.cv.style.height = hgt + 'px'
      engFit(e, false)
    }
    function engHit (e, mx, my) {
      const m = e.model; if (!m) return null
      const k = e.cam.k; const ox = e.W / 2 - e.cam.x * k; const oy = e.H / 2 - e.cam.y * k; const rs = clampN(k, 0.8, 1.5)
      let best = null; let bd = 1e9
      const list = e.view === 'orbit' ? m.nodes.slice().sort((a, b) => a.z - b.z) : m.nodes
      for (const n of list) {
        if (!engMatch(e, n)) continue
        const dx = n.x * k + ox - mx; const dy = n.y * k + oy - my; const r = engRad(n) * rs * (e.view === 'orbit' ? engOrbitScale(n) : 1) + 5; const d = Math.sqrt(dx * dx + dy * dy)
        if (d <= r && d <= bd + (e.view === 'orbit' ? 3 : 0)) { bd = d; best = n }
      }
      return best
    }
    function engStar (c, x, y, ro, ri) { c.moveTo(x, y - ro); for (let i = 1; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 2; const r = i % 2 ? ri : ro; c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) } c.closePath() }
    function engShape (c, kind, x, y, r) {
      c.beginPath()
      switch (kind) {
        case 'kyber': engStar(c, x, y, r * 1.4, r * 0.55); break
        case 'skill': c.moveTo(x, y - r * 1.2); c.lineTo(x + r * 1.2, y); c.lineTo(x, y + r * 1.2); c.lineTo(x - r * 1.2, y); c.closePath(); break
        case 'lesson': c.moveTo(x, y - r * 1.15); c.lineTo(x + r * 1.1, y + r * 0.85); c.lineTo(x - r * 1.1, y + r * 0.85); c.closePath(); break
        case 'routine': for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i + Math.PI / 6; c[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r * 1.1, y + Math.sin(a) * r * 1.1) } c.closePath(); break
        case 'app': { const t = r * 0.42; const u = r * 1.1; c.moveTo(x - t, y - u); c.lineTo(x + t, y - u); c.lineTo(x + t, y - t); c.lineTo(x + u, y - t); c.lineTo(x + u, y + t); c.lineTo(x + t, y + t); c.lineTo(x + t, y + u); c.lineTo(x - t, y + u); c.lineTo(x - t, y + t); c.lineTo(x - u, y + t); c.lineTo(x - u, y - t); c.lineTo(x - t, y - t); c.closePath(); break }
        default: c.arc(x, y, r, 0, Math.PI * 2)
      }
    }
    function engNode (e, c, n, x, y, r, col, alpha) {
      const C = e.colors
      c.globalAlpha = alpha
      if (n.kind === 'run') {
        c.beginPath(); c.arc(x, y, r, 0, 7); c.lineWidth = 3; c.strokeStyle = C.bg; c.stroke()
        if (n.run.ok) { c.lineWidth = 1.8; c.strokeStyle = col; c.stroke() } else { c.fillStyle = C.err; c.fill(); c.lineWidth = 1.4; c.strokeStyle = C.err; c.stroke() }
        return
      }
      if (n.kind === 'root') {
        c.beginPath(); c.arc(x, y, r + 4, 0, 7); c.lineWidth = 1.6; c.strokeStyle = C.ink; c.stroke()
        c.beginPath(); c.arc(x, y, r - 2, 0, 7); c.fillStyle = C.ink; c.fill(); return
      }
      engShape(c, n.kind, x, y, r); c.lineWidth = 2.6; c.strokeStyle = C.bg; c.lineJoin = 'round'; c.stroke(); c.fillStyle = col; c.fill()
      if (n.kind === 'area') { c.beginPath(); c.arc(x, y, r * 0.4, 0, 7); c.fillStyle = C.bg; c.fill() }
    }
    function engDraw (e, t) {
      const C = e.colors; const m = e.model; const c = e.ctx
      if (!C || !m || !c || !e.lay) return
      const W = e.W; const H = e.H; const view = e.view; const pr = e.props
      c.setTransform(e.DPR, 0, 0, e.DPR, 0, 0); c.clearRect(0, 0, W, H)
      const k = e.cam.k; const ox = W / 2 - e.cam.x * k; const oy = H / 2 - e.cam.y * k
      const drift = pr.motion && !reduced ? 1 : 0; const tt = t * 0.0007; const P = {}
      for (const n of m.nodes) P[n.id] = [n.x * k + ox + (drift ? Math.sin(tt + n.h * 9) * 1.7 : 0), n.y * k + oy + (drift ? Math.cos(tt * 1.1 + n.h * 7) * 1.7 : 0)]
      const fid = e.hover || pr.sel
      let fs = null
      if (fid && m.adj[fid]) { fs = new Set(m.adj[fid]); fs.add(fid) }
      const rs = clampN(k, 0.8, 1.5)
      const filtering = !!pr.iso || !!pr.query
      const nMatch = filtering ? m.nodes.filter((n) => engMatch(e, n)).length : m.nodes.length
      // guides, in world space
      c.save(); c.translate(ox, oy); c.scale(k, k); c.lineWidth = 1 / k; c.strokeStyle = C.line1; c.fillStyle = C.ink3; c.font = (11 / k) + 'px ' + C.font; c.textAlign = 'center'
      if (view === 'rings') { RING_R.forEach((r, i) => { if (!i) return; c.beginPath(); c.arc(0, 0, r, 0, 7); c.stroke(); c.fillText(LAYER_NAME[LAYERS[i]], 0, -r - 6 / k) }) } else if (view === 'circle') { c.beginPath(); c.arc(0, 0, 330, 0, 7); c.stroke() } else if (view === 'areas') {
        for (const ar of m.areas) { const hl = e.lay.halos[ar.id]; if (!hl) continue; c.globalAlpha = 0.07; c.fillStyle = C.areas[ar.idx]; c.beginPath(); c.arc(hl.x, hl.y, hl.r, 0, 7); c.fill(); c.globalAlpha = 1; c.fillStyle = C.ink3 }
      } else if (view === 'timeline') {
        c.textAlign = 'left'; c.fillText('AUTOMATION RUNS · LAST 14 DAYS', -575, -326); c.fillText('FILES BY LAST CHANGE', -575, 66)
        c.textAlign = 'center'
        for (let d = 0; d <= 13; d += 2) { const x = TL.x1 - d * ((TL.x1 - TL.x0) / 13); c.beginPath(); c.moveTo(x, -40); c.lineTo(x, -34); c.stroke(); c.fillText(d === 0 ? 'today' : shortDate(d, m.now), x, -20) }
        c.beginPath(); c.moveTo(TL.x0 - 14, -40); c.lineTo(TL.x1 + 14, -40); c.stroke()
        if (!m.hasRuns) c.fillText('No automation run in the last 14 days.', (TL.x0 + TL.x1) / 2, -150)
        ;[0, 7, 30, 90, 180].forEach((d) => { const x = tlx(d); c.beginPath(); c.moveTo(x, 76); c.lineTo(x, 100 + 7 * 34); c.stroke(); c.fillText(d === 0 ? 'today' : shortDate(d, m.now), x, 100 + 7 * 34 + 24) })
        c.beginPath(); c.moveTo(TL.nod, 76); c.lineTo(TL.nod, 100 + 7 * 34); c.stroke(); c.fillText('no date', TL.nod, 100 + 7 * 34 + 24)
        c.textAlign = 'left'; TL.lanes.forEach((l, i) => { c.fillText(KIND_NAME_ALL[l], -575, 104 + i * 34) })
      }
      c.restore()
      // links
      const circ = view === 'circle'; const cx0 = ox; const cy0 = oy; const pid = e.hover || pr.sel
      for (const l of m.links) {
        const a = m.byId[l.s]; const pa = P[l.s]; const aOn = engMatch(e, a)
        if (l.bad) {
          let ang = Math.atan2(pa[1] - cy0, pa[0] - cx0); if (view === 'timeline' || view === 'links' || view === 'areas') ang = -Math.PI / 2 + a.h * 5
          const r0 = engRad(a) * rs + 2; const ex = pa[0] + Math.cos(ang) * (r0 + 20); const ey = pa[1] + Math.sin(ang) * (r0 + 20)
          c.globalAlpha = (fs && !fs.has(a.id) ? 0.15 : 1) * (aOn ? 1 : 0.12); c.strokeStyle = C.err; c.lineWidth = 1.4; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(pa[0] + Math.cos(ang) * r0, pa[1] + Math.sin(ang) * r0); c.lineTo(ex, ey); c.stroke(); c.setLineDash([])
          c.beginPath(); c.moveTo(ex - 3.5, ey - 3.5); c.lineTo(ex + 3.5, ey + 3.5); c.moveTo(ex + 3.5, ey - 3.5); c.lineTo(ex - 3.5, ey + 3.5); c.stroke(); continue
        }
        if (l.inf && pr.inferred === false) continue
        const b = m.byId[l.t]; const pb = P[l.t]; const on = fs !== null && (l.s === pid || l.t === pid)
        if (view === 'timeline' && !on) continue
        let al = on ? 0.95 : fs ? 0.05 : (view === 'orbit' ? 0.1 + 0.25 * Math.min(a.ds, b.ds) : 0.2)
        if (filtering && !(aOn && engMatch(e, b))) al *= 0.15
        c.globalAlpha = al; c.lineWidth = on ? 1.8 : 1; c.strokeStyle = on ? engColorOf(e, a.kind === 'root' ? b : a) : C.ink3; c.setLineDash(l.inf ? [4, 4] : [])
        c.beginPath(); c.moveTo(pa[0], pa[1])
        if (circ) { const mx = (pa[0] + pb[0]) / 2; const my = (pa[1] + pb[1]) / 2; c.quadraticCurveTo(cx0 + (mx - cx0) * 0.28, cy0 + (my - cy0) * 0.28, pb[0], pb[1]) } else c.lineTo(pb[0], pb[1])
        c.stroke()
      }
      c.setLineDash([])
      // nodes
      const list = m.nodes.slice()
      if (view === 'orbit') list.sort((a, b) => b.z - a.z); else list.sort((a, b) => (a.kind === 'root') - (b.kind === 'root') || (a.kind === 'run') - (b.kind === 'run') || a.deg - b.deg)
      const labels = []
      for (const n of list) {
        const p = P[n.id]; const r = engRad(n) * rs * (view === 'orbit' ? engOrbitScale(n) : 1); const on = engMatch(e, n)
        let al = (fs ? (fs.has(n.id) ? 1 : 0.16) : 1) * (on ? 1 : 0.1); if (view === 'orbit') al *= 0.45 + 0.55 * clampN((n.ds - 0.7) / 0.6, 0, 1)
        if (p[0] < -30 || p[1] < -30 || p[0] > W + 30 || p[1] > H + 30) continue
        engNode(e, c, n, p[0], p[1], r, engColorOf(e, n), al)
        const prb = n.problem
        if (prb && n.id !== pr.sel) { c.globalAlpha = al; c.setLineDash([2.5, 2.5]); c.lineWidth = 1.3; c.strokeStyle = prb.sev === 'err' ? C.err : C.warn; c.beginPath(); c.arc(p[0], p[1], r + 4.5, 0, 7); c.stroke(); c.setLineDash([]) }
        if (n.id === pr.sel || n.id === e.hover) { c.globalAlpha = 1; c.lineWidth = 1.8; c.strokeStyle = C.ink; c.beginPath(); c.arc(p[0], p[1], r + 5, 0, 7); c.stroke() }
        const base = n.kind === 'area' && view !== 'timeline'; const hot = fs !== null && fs.has(n.id); const pick = n.id === pr.sel || n.id === e.hover
        if ((pr.names && al > 0.5) || base || pick || (hot && fs.size < 14) || (filtering && on && n.kind !== 'run' && nMatch < 16)) labels.push({ n, p, r, pri: (pick ? 4 : 0) + (base ? 3 : 0) + (hot ? 2 : 0) + n.deg / 20, al })
      }
      // labels, with simple collision culling
      labels.sort((a, b) => b.pri - a.pri)
      const boxes = []; c.textAlign = 'left'
      for (const o of labels) {
        const n = o.n; const bold = n.kind === 'root' || n.kind === 'area'
        c.font = (bold ? '600 ' : '') + '12px ' + C.font
        const key = n.label + bold; const w = e.cw[key] || (e.cw[key] = c.measureText(n.label).width)
        const radial = view === 'rings' || view === 'circle' || view === 'orbit'; const side = radial && o.p[0] < cx0 - 1 ? -1 : 1
        const x = o.p[0] + side * (o.r + (n.kind === 'root' ? 6 : 5)); const y = o.p[1] + 4; const bx = side < 0 ? [x - w - 2, y - 12, x + 2, y + 4] : [x - 2, y - 12, x + w + 2, y + 4]
        c.textAlign = side < 0 ? 'right' : 'left'
        if (o.pri < 4 && boxes.some((b) => !(bx[2] < b[0] || bx[0] > b[2] || bx[3] < b[1] || bx[1] > b[3]))) continue
        boxes.push(bx); c.globalAlpha = o.al; c.lineWidth = 3.5; c.strokeStyle = C.bg; c.lineJoin = 'round'; c.strokeText(n.label, x, y); c.fillStyle = bold ? C.ink : C.ink2; c.fillText(n.label, x, y)
      }
      c.globalAlpha = 1
    }
    // One frame: tween the nodes and the camera towards their targets, draw only when something moved.
    function engFrame (e, t) {
      const m = e.model
      if (!m || !e.W || !e.lay) return
      const dt = Math.min((t - e.last) / 1000 || 0.016, 0.05); e.last = t
      if (e.view === 'orbit') { engOrbit(e, t); e.dirty = true }
      if (e.follow && m.byId[e.follow]) { e.camT.x = m.byId[e.follow].tx; e.camT.y = m.byId[e.follow].ty }
      const a = 1 - Math.exp(-dt * 9); let moved = false
      for (const n of m.nodes) { const dx = n.tx - n.x; const dy = n.ty - n.y; if (Math.abs(dx) + Math.abs(dy) > 0.02) { n.x += dx * a; n.y += dy * a; moved = true } else { n.x = n.tx; n.y = n.ty } }
      const dk = e.camT.k - e.cam.k; const dxx = e.camT.x - e.cam.x; const dyy = e.camT.y - e.cam.y
      if (Math.abs(dk) > 0.0005 || Math.abs(dxx) > 0.05 || Math.abs(dyy) > 0.05) { e.cam.k += dk * a; e.cam.x += dxx * a; e.cam.y += dyy * a; moved = true }
      if (moved || e.dirty || (e.props.motion && !reduced)) { engDraw(e, t); e.dirty = false }
    }

    // ══ 3. INTERFACE ═════════════════════════════════════════════════════════
    // A bundle must never stop DSH from starting: if React cannot be required the page is simply not registered.
    let React = null
    try { React = typeof require === 'function' ? require('react') : null } catch (e) { React = null }
    const h = React ? React.createElement : null

    const CSS = `
.kbat-page{--kbat-p0:#2a78d6;--kbat-p1:#eb6834;--kbat-p2:#1baf7a;--kbat-p3:#eda100;--kbat-p4:#e87ba4;--kbat-p5:#4a3aa7;--kbat-p6:var(--dsw-alias-label-tertiary);display:flex;flex-direction:column;gap:14px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
body[data-ds-dark-theme] .kbat-page{--kbat-p0:#3987e5;--kbat-p1:#d95926;--kbat-p2:#199e70;--kbat-p3:#c98500;--kbat-p4:#d55181;--kbat-p5:#9085e9}
/* DSH caps every Settings page at 720px: [class$="_options"] [data-slot="settings.section"] > * (specificity 0,2,0). The map needs the room. */
[data-slot="settings.section"] > .kbat-page.kbat-page{width:100%;max-width:1240px}
.kbat-page *{box-sizing:border-box}
.kbat-page button{font:inherit;color:inherit;cursor:pointer}
.kbat-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:10px 24px}
.kbat-title{margin:0;font-size:18px;line-height:26px;font-weight:600;letter-spacing:-.01em}
.kbat-sub{margin:2px 0 0;max-width:62ch;color:var(--dsw-alias-label-secondary)}
.kbat-headr{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.kbat-built{display:inline-flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px}
.kbat-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary,#22c55e)}
.kbat-dot[data-t="warn"]{background:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbat-dot[data-t="err"]{background:var(--dsw-alias-state-error-primary,#ec1313)}
.kbat-dot[data-t="idle"]{background:var(--dsw-alias-label-caption)}
.kbat-dot[data-t="busy"]{background:transparent;border:2px solid var(--dsw-alias-border-l3);border-top-color:var(--dsw-alias-label-primary);animation:kbat-spin .8s linear infinite}
@keyframes kbat-spin{to{transform:rotate(360deg)}}
.kbat-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding-inline:14px;border-radius:16px;border:1px solid var(--dsw-alias-border-l2);background:transparent;white-space:nowrap}
.kbat-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.kbat-btn:disabled{opacity:.45;cursor:default}
.kbat-btn[data-primary="true"]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent}
.kbat-page :focus-visible{outline:2px solid var(--dsw-alias-brand-primary-new-color,#4176e6);outline-offset:2px}
.kbat-banner{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 14px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover)}
.kbat-banner .kbat-sp{flex:1;min-width:0}
.kbat-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
.kbat-seg{display:inline-flex;gap:2px;padding:2px;border-radius:18px;background:var(--dsw-alias-interactive-bg-hover)}
.kbat-seg button{border:0;background:transparent;height:32px;padding-inline:16px;border-radius:16px;color:var(--dsw-alias-label-secondary)}
.kbat-seg button:hover{color:var(--dsw-alias-label-primary)}
.kbat-seg button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);box-shadow:0 0 0 1px var(--dsw-alias-border-l2)}
.kbat-picker{position:relative}
.kbat-pkbtn{display:inline-flex;align-items:center;gap:8px;height:32px;padding-inline:14px;border-radius:16px;border:1px solid var(--dsw-alias-border-l2);background:transparent}
.kbat-pkbtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbat-pkbtn .kbat-k{color:var(--dsw-alias-label-tertiary)}
.kbat-pkbtn b{font-weight:600}
.kbat-pop{position:absolute;z-index:30;top:36px;left:0;width:min(340px,calc(100vw - 32px));max-height:440px;display:flex;flex-direction:column;padding:6px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);box-shadow:0 8px 24px rgba(0,0,0,.25)}
.kbat-pop input,.kbat-filter{height:32px;border-radius:16px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;font:inherit;padding-inline:12px}
.kbat-pop input{margin-bottom:6px}
.kbat-pop ul{list-style:none;margin:0;padding:0;overflow:auto}
.kbat-pop .kbat-hd{padding:8px 8px 2px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.kbat-pop .kbat-o{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer}
.kbat-pop .kbat-o[aria-selected="true"],.kbat-pop .kbat-o:hover{background:var(--dsw-alias-interactive-bg-hover-accent)}
.kbat-pop .kbat-sub2{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:12px}
.kbat-body{display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px;align-items:start}
.kbat-rail{display:flex;flex-direction:column;gap:12px;min-width:0}
.kbat-stage{position:relative;min-height:420px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.kbat-around{padding:14px 20px 28px;overflow:auto;max-height:78vh;min-height:420px}
.kbat-cap{margin:0 0 14px;color:var(--dsw-alias-label-secondary);font-size:12px;max-width:70ch}
.kbat-cap b{color:var(--dsw-alias-label-primary);font-weight:600}
.kbat-grid{position:relative;display:grid;grid-template-columns:repeat(4,minmax(176px,1fr));column-gap:52px;min-width:820px;align-items:start}
.kbat-lines{position:absolute;left:0;top:0;pointer-events:none;z-index:0;overflow:visible}
.kbat-lines path{fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-width:1.2;opacity:.45}
.kbat-lines path[data-inf="1"]{stroke-dasharray:4 4}
.kbat-grid[data-hover="1"] .kbat-lines path{opacity:.07}
.kbat-grid[data-hover="1"] .kbat-lines path[data-hot="1"]{opacity:1;stroke:var(--dsw-alias-brand-primary-new-color,#4176e6);stroke-width:1.8}
.kbat-col{position:relative;z-index:1;display:flex;flex-direction:column;gap:6px;min-width:0}
.kbat-col h3{margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.kbat-col h4{margin:10px 0 0;font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.kbat-col h4 span{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.kbat-none{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px}
.kbat-pn{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;text-align:left;padding:6px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.kbat-pn:hover{background:var(--dsw-alias-bg-layer-2)}
.kbat-pn .kbat-pt{min-width:0;flex:1}
.kbat-pn .kbat-pt b{display:block;font-weight:500;overflow-wrap:anywhere}
.kbat-pn .kbat-pt i{display:block;font-style:normal;color:var(--dsw-alias-label-tertiary);font-size:12px}
.kbat-pn .kbat-pw{flex:none;display:inline-flex;color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbat-pn[data-sev="err"] .kbat-pw{color:var(--dsw-alias-state-error-primary,#ec1313)}
.kbat-pn[data-bad="1"]{border-style:dashed;border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 65%,transparent)}
.kbat-pn[data-bad="1"][data-sev="err"]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ec1313) 65%,transparent)}
.kbat-pn[data-sel="1"]{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary)}
.kbat-pn[data-ghost="1"]{background:transparent}
.kbat-pn[data-ghost="1"] .kbat-pt b{text-decoration:line-through;text-decoration-color:var(--dsw-alias-state-error-primary,#ec1313);font-weight:400}
.kbat-grid[data-hover="1"] .kbat-pn:not([data-hot="1"]){opacity:.38}
.kbat-more{align-self:flex-start;border:0;background:transparent;padding:4px 6px;border-radius:8px;color:var(--dsw-alias-label-secondary);font-size:12px;text-decoration:underline;text-underline-offset:3px}
.kbat-more:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbat-tc{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.kbat-tc summary{display:flex;align-items:center;gap:8px;padding:12px 14px;cursor:pointer;font-weight:600;list-style:none}
.kbat-tc summary::-webkit-details-marker{display:none}
.kbat-tc summary::after{content:"";margin-left:auto;width:7px;height:7px;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);transform:rotate(45deg) translateY(-2px)}
.kbat-tc[open] summary::after{transform:rotate(-135deg)}
.kbat-count[data-zero="1"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.kbat-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding-inline:6px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 22%,transparent);font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}
.kbat-tc p{margin:0;padding:0 14px 8px;color:var(--dsw-alias-label-secondary);font-size:12px}
.kbat-tc ul{list-style:none;margin:0;padding:0 6px 8px;display:flex;flex-direction:column;gap:2px}
.kbat-tc li button{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;border:0;background:transparent;border-radius:10px;padding:8px}
.kbat-tc li button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbat-tc .kbat-ic{flex:none;margin-top:2px;color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbat-tc .kbat-ic[data-sev="err"]{color:var(--dsw-alias-state-error-primary,#ec1313)}
.kbat-tc .kbat-tx b{display:block;font-weight:500}
.kbat-tc .kbat-tx u{text-decoration:none;color:var(--dsw-alias-label-tertiary);font-weight:400;font-size:12px;margin-left:4px}
.kbat-tc .kbat-tx i{display:block;font-style:normal;color:var(--dsw-alias-label-secondary);font-size:12px}
.kbat-card{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);position:relative}
.kbat-card h3{margin:0;padding-right:28px;font-size:15px;line-height:20px;font-weight:600;display:flex;gap:8px;align-items:flex-start}
.kbat-card h3 svg{margin-top:4px;flex:none}
.kbat-x{position:absolute;right:8px;top:8px;width:28px;height:28px;border-radius:14px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:18px;line-height:1}
.kbat-x:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbat-meta{display:flex;flex-wrap:wrap;gap:6px}
.kbat-pill{display:inline-flex;align-items:center;gap:6px;height:22px;padding-inline:8px;border-radius:11px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:12px}
.kbat-note{margin:0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.kbat-callout{display:flex;gap:8px;padding:8px 10px;border-radius:10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 10%,transparent);font-size:12px}
.kbat-callout[data-sev="err"]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ec1313) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ec1313) 10%,transparent)}
.kbat-kv{display:grid;grid-template-columns:64px 1fr;gap:4px 10px;margin:0;font-size:12px}
.kbat-kv dt{color:var(--dsw-alias-label-tertiary)}
.kbat-kv dd{margin:0;min-width:0;overflow-wrap:anywhere}
.kbat-mono{font-family:var(--ds-font-family-code,ui-monospace,Menlo,monospace);font-size:11.5px}
.kbat-acts{display:flex;flex-wrap:wrap;gap:6px}
.kbat-acts .kbat-btn{height:28px;padding-inline:12px;font-size:12px}
.kbat-ro{margin:0;color:var(--dsw-alias-label-caption);font-size:12px}
.kbat-list{max-height:78vh;min-height:420px;overflow:auto}
.kbat-listbar{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);position:sticky;top:0;background:var(--dsw-alias-bg-layer-1);z-index:2}
.kbat-filter{flex:1;max-width:340px}
.kbat-list table{width:100%;border-collapse:collapse;min-width:620px}
.kbat-list th{text-align:left;font-weight:500;color:var(--dsw-alias-label-tertiary);font-size:12px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.kbat-list td{padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:middle}
.kbat-list td:not(:first-child){white-space:nowrap}
.kbat-list tr[data-row]{cursor:pointer}
.kbat-list tr[data-row]:hover,.kbat-list tr[aria-selected="true"]{background:var(--dsw-alias-interactive-bg-hover)}
.kbat-nm{display:inline-flex;align-items:center;gap:8px}
.kbat-flag{display:inline-block;margin-left:6px;font-size:11px;padding:0 6px;border-radius:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 60%,transparent);color:var(--dsw-alias-label-secondary)}
.kbat-flag[data-sev="err"]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ec1313) 60%,transparent)}
.kbat-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:48px 24px;text-align:center;min-height:360px}
.kbat-state h2{margin:0;font-size:16px;font-weight:600}
.kbat-state p{margin:0;max-width:52ch;color:var(--dsw-alias-label-secondary)}
.kbat-srcs{list-style:none;margin:0;padding:0;display:grid;gap:4px;min-width:min(340px,100%);text-align:left}
.kbat-srcs li{display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover)}
.kbat-srcs .kbat-s{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px}
.kbat-srcs li[data-bad="1"] .kbat-s{color:var(--dsw-alias-state-error-primary,#ec1313)}
.kbat-modal{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;background:rgba(0,0,0,.5);overflow:auto}
.kbat-mcard{position:relative;width:min(560px,100%);margin-block:auto;padding:22px 24px 20px;border-radius:16px;border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);box-shadow:0 20px 48px rgba(0,0,0,.4);display:flex;flex-direction:column;gap:14px;outline:none}
.kbat-mcard h2{margin:0;font-size:18px;line-height:26px;font-weight:600;padding-right:32px}
.kbat-mcard h3{margin:0 0 4px;font-size:13px;font-weight:600}
.kbat-mcard p,.kbat-mcard li,.kbat-mcard dd{margin:0;color:var(--dsw-alias-label-secondary)}
.kbat-mcard .kbat-lead{color:var(--dsw-alias-label-primary)}
.kbat-mcard b{color:var(--dsw-alias-label-primary);font-weight:600}
.kbat-mcard ul{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:3px}
.kbat-mcard ul.kbat-key{list-style:none;padding:0;gap:8px}
.kbat-mcard .kbat-key li{display:flex;gap:12px;align-items:center}
.kbat-mcard .kbat-key svg{flex:none;color:var(--dsw-alias-label-secondary)}
.kbat-mcard dl{margin:0;display:grid;grid-template-columns:92px 1fr;gap:5px 12px}
.kbat-mcard dt{font-weight:600;color:var(--dsw-alias-label-primary)}
.kbat-ghostkey{flex:none;display:inline-flex;min-width:44px;max-width:120px;justify-content:center;padding:2px 8px;border-radius:8px;border:1px dashed var(--dsw-alias-state-error-primary,#ec1313);font-size:12px;text-decoration:line-through;text-decoration-color:var(--dsw-alias-state-error-primary,#ec1313);color:var(--dsw-alias-label-secondary)}
.kbat-foot2{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.kbat-seg{flex-wrap:wrap}
.kbat-btn[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover-accent)}
.kbat-panel{display:flex;flex-direction:column;gap:10px;min-width:0}
.kbat-panel[data-full="1"]{position:fixed;inset:0;z-index:2147482000;background:var(--dsw-alias-bg-base);padding:12px 16px;overflow:auto}
.kbat-panel[data-full="1"] .kbat-stage[data-canvas="1"]{flex:1;height:auto;min-height:0}
.kbat-stage[data-canvas="1"]{height:clamp(520px,76vh,860px)}
.kbat-canvas{position:absolute;inset:0;touch-action:none;cursor:grab}
.kbat-canvas[data-hot="1"]{cursor:pointer}
.kbat-canvas:active{cursor:grabbing}
.kbat-cap2{position:absolute;left:14px;top:12px;max-width:min(46ch,60%);color:var(--dsw-alias-label-secondary);font-size:12px;pointer-events:none;z-index:2}
.kbat-cap2 b{color:var(--dsw-alias-label-primary);font-weight:600}
.kbat-count2{position:absolute;left:14px;bottom:12px;color:var(--dsw-alias-label-tertiary);font-size:12px;pointer-events:none;font-variant-numeric:tabular-nums;z-index:2}
.kbat-hud{position:absolute;right:12px;bottom:12px;display:flex;flex-direction:column;gap:4px;z-index:3}
.kbat-hud .kbat-btn{background:var(--dsw-alias-bg-layer-2)}
.kbat-icon{width:32px;padding:0}
.kbat-tip{position:absolute;z-index:5;pointer-events:none;max-width:240px;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l3);box-shadow:0 6px 18px rgba(0,0,0,.25);font-size:12px}
.kbat-tip b{display:block;font-weight:600}
.kbat-tip span{color:var(--dsw-alias-label-secondary)}
.kbat-stage > .kbat-card.kbat-float{position:absolute;right:12px;top:12px;width:320px;max-height:calc(100% - 24px);overflow:auto;z-index:9;box-shadow:0 12px 32px rgba(0,0,0,.35)}
.kbat-search{position:relative;min-width:200px;flex:0 1 260px}
.kbat-search input{width:100%;height:32px;border-radius:16px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;font:inherit;padding-inline:34px 12px}
.kbat-search svg{position:absolute;left:11px;top:9px;color:var(--dsw-alias-label-tertiary);pointer-events:none}
.kbat-results{position:absolute;z-index:20;left:0;right:0;top:36px;margin:0;padding:4px;list-style:none;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);box-shadow:0 8px 24px rgba(0,0,0,.25)}
.kbat-results li{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer}
.kbat-results li[aria-selected="true"],.kbat-results li:hover{background:var(--dsw-alias-interactive-bg-hover-accent)}
.kbat-results .kbat-sub2{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:12px}
.kbat-results .kbat-none2{color:var(--dsw-alias-label-tertiary);cursor:default}
.kbat-legend{display:flex;flex-direction:column;gap:6px}
.kbat-lrow{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.kbat-lbl{width:48px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.kbat-chip{display:inline-flex;align-items:center;gap:6px;height:24px;padding-inline:10px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:transparent;font-size:12px;color:var(--dsw-alias-label-secondary)}
.kbat-chip:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.kbat-chip:disabled{opacity:.5;cursor:default}
.kbat-chip[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.kbat-chip[data-check="1"]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 55%,transparent)}
.kbat-chip[data-check="1"] svg{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbat-chip .kbat-n{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
@media (max-width:900px){.kbat-body{grid-template-columns:minmax(0,1fr)}}
@media (max-width:720px){.kbat-lbl{width:100%}.kbat-count2{display:none}}
@media (prefers-reduced-motion:reduce){.kbat-dot[data-t="busy"]{animation:none}}
`
    const poserCss = () => {
      try {
        if (document.getElementById('kbat-css') !== null) return
        const s = document.createElement('style'); s.id = 'kbat-css'; s.textContent = CSS; document.head.appendChild(s)
      } catch (e) { /* no document: nothing to style */ }
    }

    const areaVar = (g, n) => { if (n.kind === 'root') return 'var(--dsw-alias-label-primary)';  const a = g.areas.filter((x) => x.id === n.area)[0]; return 'var(--kbat-p' + (a ? a.idx : 6) + ')' }
    function Glyph (p) {
      const s = p.size || 12; const c = p.color || 'currentColor'; const m = s / 2
      const svg = (...kids) => h('svg', { width: s, height: s, viewBox: '0 0 ' + s + ' ' + s, 'aria-hidden': 'true', style: { flex: 'none' } }, ...kids)
      switch (p.kind) {
        case 'root': return svg(h('circle', { cx: m, cy: m, r: m - 0.8, fill: 'none', stroke: c, strokeWidth: 1.2 }), h('circle', { cx: m, cy: m, r: m * 0.45, fill: c }))
        case 'run': return svg(h('circle', { cx: m, cy: m, r: m * 0.55, fill: 'none', stroke: c, strokeWidth: 1.6 }))
        case 'area': return svg(h('circle', { cx: m, cy: m, r: m - 0.5, fill: c }), h('circle', { cx: m, cy: m, r: m * 0.38, style: { fill: 'var(--dsw-alias-bg-layer-1)' } }))
        case 'kyber': { const pts = []; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 2; const r = i % 2 ? m * 0.4 : m - 0.4; pts.push((m + Math.cos(a) * r).toFixed(2) + ' ' + (m + Math.sin(a) * r).toFixed(2)) } return svg(h('path', { d: 'M' + pts.join('L') + 'Z', fill: c })) }
        case 'skill': return svg(h('path', { d: 'M' + m + ' .8L' + (s - 0.8) + ' ' + m + ' ' + m + ' ' + (s - 0.8) + ' .8 ' + m + 'Z', fill: c }))
        case 'lesson': return svg(h('path', { d: 'M' + m + ' 1L' + (s - 0.8) + ' ' + (s - 1.5) + ' .8 ' + (s - 1.5) + 'Z', fill: c }))
        case 'routine': return svg(h('path', { d: 'M' + m + ' .8L' + (s * 0.9) + ' ' + (s * 0.28) + ' ' + (s * 0.9) + ' ' + (s * 0.72) + ' ' + m + ' ' + (s - 0.8) + ' ' + (s * 0.1) + ' ' + (s * 0.72) + ' ' + (s * 0.1) + ' ' + (s * 0.28) + 'Z', fill: c }))
        case 'app': { const t = 1.7; const u = m - 0.6; return svg(h('path', { d: 'M' + (m - t) + ' ' + (m - u) + 'h' + 2 * t + 'v' + (u - t) + 'h' + (u - t) + 'v' + 2 * t + 'h-' + (u - t) + 'v' + (u - t) + 'h-' + 2 * t + 'v-' + (u - t) + 'h-' + (u - t) + 'v-' + 2 * t + 'h' + (u - t) + 'Z', fill: c })) }
        case 'warn': return svg(h('path', { d: 'M' + m + ' 1L' + (s - 0.8) + ' ' + (s - 1.5) + ' .8 ' + (s - 1.5) + 'Z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }), h('path', { d: 'M' + m + ' ' + (s * 0.38) + 'v' + (s * 0.23), stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }))
        default: return svg(h('circle', { cx: m, cy: m, r: m * 0.78, fill: c }))
      }
    }

    function HelpDialog (p) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        const prev = document.activeElement
        const onKey = (e) => {
          if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); p.onClose() }
          else if (e.key === 'Tab' && ref.current) {
            const f = Array.from(ref.current.querySelectorAll('button')); const i = f.indexOf(document.activeElement)
            if (f.length === 0) return
            if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus() } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus() }
          }
        }
        window.addEventListener('keydown', onKey, true) // capture: the Settings dialog also closes on Escape
        if (ref.current) { try { ref.current.focus({ preventScroll: true }) } catch (e) { ref.current.focus() } ref.current.parentNode.scrollTop = 0 } // the dialog itself: focusing the last button would scroll the title away
        return () => { window.removeEventListener('keydown', onKey, true); try { if (prev && prev.focus) prev.focus() } catch (e) { /* gone */ } }
      }, [])
      const line = (dash, inf) => h('svg', { width: 44, height: 12, 'aria-hidden': 'true' }, h('path', { d: 'M2 6h40', stroke: 'currentColor', strokeWidth: 1.6, strokeDasharray: dash }))
      return h('div', { className: 'kbat-modal', onPointerDown: (e) => { if (e.target === e.currentTarget) p.onClose() } },
        h('div', { className: 'kbat-mcard', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kbat-help-t', ref, tabIndex: -1 },
          h('button', { type: 'button', className: 'kbat-x', 'aria-label': 'Close help', onClick: p.onClose }, '×'),
          h('h2', { id: 'kbat-help-t' }, 'How to read the Atlas'),
          h('p', { className: 'kbat-lead' }, 'The Atlas shows how the things you set up fit together. It only reads your files and plugins. It never edits or stores anything.'),
          h('section', null, h('h3', null, 'The views'),
            h('dl', null,
              h('dt', null, 'Around'), h('dd', null, 'Pick a project or a kyber in “Start from”. Four columns show who works there, what they use and what they know. Hover a name to light up its lines.'),
              h('dt', null, 'Rings'), h('dd', null, 'The whole workspace: one ring per layer, the workspace in the middle, each project keeping its wedge.'),
              h('dt', null, 'Circle'), h('dd', null, 'Every node on one ring, grouped by project. Links cross the middle.'),
              h('dt', null, 'Areas'), h('dd', null, 'One cluster per project. Lines between clusters show what crosses projects.'),
              h('dt', null, 'Links'), h('dd', null, 'Nodes pulled together by what they reference. Loose ends drift to the edge.'),
              h('dt', null, 'Timeline'), h('dd', null, 'Automation runs of the last 14 days on top, everything else by last change below.'),
              h('dt', null, 'Orbit'), h('dd', null, 'The rings as a stack that turns on its own. Drag to turn it.'),
              h('dt', null, 'List'), h('dd', null, 'The same things as a table. The text version of every drawing.'))),
          h('section', null, h('h3', null, 'In the drawings'), h('p', null, 'Click a dot for details. Search finds a name and flies to it. Click a legend chip to isolate it. Names shows every name, Motion lets the dots drift, and Lessons adds the lessons, which are many and so off by default. Ctrl or ⌘ + scroll, or the + and − buttons, zoom.')),
          h('section', null, h('h3', null, 'The lines'),
            h('ul', { className: 'kbat-key' },
              h('li', null, line(undefined), h('span', null, h('b', null, 'Solid. '), 'Written in a file. For example, a kyber lists a skill.')),
              h('li', null, line('4 4'), h('span', null, h('b', null, 'Dashed. '), 'Guessed from a name. For example, an app that matches one of a kyber’s tools.')),
              h('li', null, h('span', { className: 'kbat-ghostkey' }, 'brand-voice'), h('span', null, h('b', null, 'Crossed out, red. '), 'Points to something that no longer exists, such as a skill that is not installed.')))),
          h('section', null, h('h3', null, 'To check'), h('p', null, 'Red items are broken links. Amber items look wrong, for example an automation whose last run failed. Click one to see where it is on the map. Skills that nobody declares are not listed: skills are mostly used by name, on demand.')),
          h('section', null, h('h3', null, 'Words'),
            h('dl', null,
              h('dt', null, 'Project'), h('dd', null, 'A workspace in DSH.'),
              h('dt', null, 'Kyber'), h('dd', null, 'An agent with its own roles, skills and lessons.'),
              h('dt', null, 'Skill'), h('dd', null, 'A reusable instruction set a kyber or a project can use.'),
              h('dt', null, 'Memory'), h('dd', null, 'Facts kept in your kybernos.app account. Needs a linked account.'),
              h('dt', null, 'Lesson'), h('dd', null, 'Something a kyber learned from a past run. The most recent few are shown.'),
              h('dt', null, 'Automation'), h('dd', null, 'A scheduled task. Its last run is shown on its card.'))),
          h('section', null, h('h3', null, 'What you will not see'),
            h('ul', null,
              h('li', null, 'Sessions. Automation runs only appear in the drawings, and only the last 14 days.'),
              h('li', null, 'Which kyber worked in which project, beyond each project’s 40 most recent sessions. It is only known when a kyber was activated in a session.'),
              h('li', null, 'Account memory fact by fact. It can hold hundreds, so it is one node with a count.'),
              h('li', null, 'Memories, when no account is linked.'),
              h('li', null, 'Links no file declares. Names are the only thing it guesses from.'))),
          h('p', { className: 'kbat-foot2' }, 'The colour of a dot is its project. Grey means shared or unassigned. The shape is the kind, as in the legend.'),
          h('div', { className: 'kbat-acts', style: { justifyContent: 'flex-end' } }, h('button', { type: 'button', className: 'kbat-btn', 'data-primary': 'true', 'data-ok': '1', onClick: p.onClose }, 'Got it'))))
    }

    function Picker (p) {
      const g = p.graph
      const pair = React.useState(false); const open = pair[0]; const setOpen = pair[1]
      const qp = React.useState(''); const q = qp[0]; const setQ = qp[1]
      const ip = React.useState(0); const idx = ip[0]; const setIdx = ip[1]
      const wrap = React.useRef(null); const input = React.useRef(null)
      const items = React.useMemo(() => pickerItems(g, q), [g, q])
      const options = items.filter((x) => x.id !== undefined)
      React.useEffect(() => {
        if (!open) return undefined
        const off = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false) }
        document.addEventListener('pointerdown', off)
        setTimeout(() => { if (input.current) input.current.focus() }, 0)
        return () => document.removeEventListener('pointerdown', off)
      }, [open])
      const choose = (id) => { setOpen(false); setQ(''); p.onPick(id) }
      const focus = p.focus !== null ? g.byId[p.focus] : null
      return h('div', { className: 'kbat-picker', ref: wrap },
        h('button', { type: 'button', className: 'kbat-pkbtn', 'aria-haspopup': 'listbox', 'aria-expanded': String(open), onClick: () => { setOpen(!open); setIdx(0) } },
          h('span', { className: 'kbat-k' }, 'Start from'), h('b', null, focus ? focus.label : 'Choose…'),
          h('svg', { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d: 'M2 3.5 5 6.5 8 3.5' }))),
        open ? h('div', { className: 'kbat-pop' },
          h('input', {
            ref: input, type: 'search', value: q, placeholder: 'Search a project, kyber, skill…', 'aria-label': 'Search',
            onChange: (e) => { setQ(e.target.value); setIdx(0) },
            onKeyDown: (e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (options.length) setIdx((idx + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length) }
              else if (e.key === 'Enter') { e.preventDefault(); if (options[idx]) choose(options[idx].id) }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) }
            }
          }),
          h('ul', { role: 'listbox', 'aria-label': 'Start from' },
            options.length === 0 ? h('li', { className: 'kbat-hd', role: 'presentation' }, 'No match') : null,
            (() => { let k = -1; return items.map((it, i) => it.head !== undefined ? h('li', { key: 'h' + i, className: 'kbat-hd', role: 'presentation' }, it.head) : (k++, h('li', { key: it.id, className: 'kbat-o', role: 'option', 'aria-selected': String(k === idx), onClick: () => choose(it.id) }, h('span', null, it.label), h('span', { className: 'kbat-sub2' }, it.sub)))) })())) : null)
    }

    // The Map view. Pills are plain buttons laid out by CSS grid; the lines are measured from them after layout.
    function AroundView (p) {
      const g = p.graph; const model = React.useMemo(() => aroundModel(g, p.focus, p.expanded), [g, p.focus, p.expanded])
      const gridRef = React.useRef(null)
      const lp = React.useState({ w: 0, h: 0, paths: [] }); const geo = lp[0]; const setGeo = lp[1]
      const hp = React.useState(null); const hot = hp[0]; const setHot = hp[1]
      const measure = React.useCallback(() => {
        const host = gridRef.current; if (!host || !model) return
        const hb = host.getBoundingClientRect(); const pos = {}
        host.querySelectorAll('[data-nid]').forEach((el) => { const r = el.getBoundingClientRect(); pos[el.getAttribute('data-nid')] = { l: r.left - hb.left, r: r.right - hb.left, y: r.top - hb.top + r.height / 2, c: Number(el.getAttribute('data-col')) } })
        const paths = []
        for (const l of model.lines) {
          let a = pos[l.s]; let b = pos[l.t]; let s = l.s; let t = l.t
          if (!a || !b || a.c === b.c) continue
          if (a.c > b.c) { const x = a; a = b; b = x; const y = s; s = t; t = y }
          const x1 = a.r; const x2 = b.l; const cx = Math.max(24, (x2 - x1) / 2)
          paths.push({ key: s + '>' + t, s, t, inf: l.inferred, d: 'M' + x1 + ' ' + a.y + 'C' + (x1 + cx) + ' ' + a.y + ' ' + (x2 - cx) + ' ' + b.y + ' ' + x2 + ' ' + b.y })
        }
        setGeo({ w: host.scrollWidth, h: host.scrollHeight, paths })
      }, [model])
      React.useLayoutEffect(() => { measure() }, [measure, p.sel])
      React.useEffect(() => {
        const host = gridRef.current; if (!host || typeof ResizeObserver !== 'function') return undefined
        const ro = new ResizeObserver(() => measure()); ro.observe(host)
        return () => ro.disconnect()
      }, [measure])
      if (!model) return h('div', { className: 'kbat-state' }, h('p', null, 'Pick a project or a kyber in “Start from”.'))
      const cur = hot || p.sel
      const ids = new Set(); const nbs = new Set()
      model.cols.forEach((c) => c.groups.forEach((gr) => { gr.items.forEach((n) => ids.add(n.id)); gr.ghosts.forEach((x) => ids.add(x.id)) }))
      const on = cur !== null && ids.has(cur)
      if (on) { nbs.add(cur); model.lines.forEach((l) => { if (l.s === cur) nbs.add(l.t); if (l.t === cur) nbs.add(l.s) }) }
      const pill = (n, ci) => {
        const pr = n.problem
        return h('button', {
          key: n.id, type: 'button', className: 'kbat-pn', 'data-nid': n.id, 'data-col': ci, 'data-sev': pr ? pr.sev : undefined, 'data-bad': pr ? '1' : undefined,
          'data-sel': p.sel === n.id ? '1' : undefined, 'data-hot': on && nbs.has(n.id) ? '1' : undefined,
          onClick: () => p.onSelect(n.id), onPointerEnter: () => setHot(n.id), onPointerLeave: () => setHot(null), onFocus: () => setHot(n.id), onBlur: () => setHot(null)
        }, h(Glyph, { kind: n.kind, color: areaVar(g, n) }),
        h('span', { className: 'kbat-pt' }, h('b', null, n.label), n.sub ? h('i', null, n.sub) : null),
        pr ? h('span', { className: 'kbat-pw', title: pr.text }, h(Glyph, { kind: 'warn', size: 13 })) : null)
      }
      const ghost = (x, ci) => h('button', {
        key: x.id, type: 'button', className: 'kbat-pn', 'data-nid': x.id, 'data-col': ci, 'data-ghost': '1', 'data-bad': '1', 'data-sev': 'err', 'data-hot': on && nbs.has(x.id) ? '1' : undefined,
        onClick: () => p.onSelect(x.src), onPointerEnter: () => setHot(x.id), onPointerLeave: () => setHot(null)
      }, h('span', { className: 'kbat-pt' }, h('b', null, x.label), h('i', null, x.sub)), h('span', { className: 'kbat-pw' }, h(Glyph, { kind: 'warn', size: 13 })))
      const focusNode = model.focus
      const noMemoryNote = g.memory ? 'Account memory (' + g.memory.accountCount + ' facts) is shared by every kyber.' : 'Not read. Link your kybernos.app account to see memory.'
      return h('div', { className: 'kbat-around' },
        h('p', { className: 'kbat-cap' }, 'Around ', h('b', null, focusNode.label), '. ', focusNode.kind === 'area' ? 'Who works on this project, what they use and what they know.' : 'Where this kyber is used, what it uses and what it knows.', ' Hover a name to follow its lines.'),
        h('div', { className: 'kbat-grid', ref: gridRef, 'data-hover': on ? '1' : undefined },
          h('svg', { className: 'kbat-lines', width: geo.w, height: geo.h, 'aria-hidden': 'true' },
            geo.paths.map((q) => h('path', { key: q.key, d: q.d, 'data-inf': q.inf ? '1' : undefined, 'data-hot': on && (q.s === cur || q.t === cur) ? '1' : undefined }))),
          model.cols.map((c, ci) => {
            let any = false
            const groups = c.groups.map((gr) => {
              if (gr.total === 0) {
                if (gr.kind === 'memory') return h('div', { key: gr.key, className: 'kbat-col-g' }, h('h4', null, gr.label), h('p', { className: 'kbat-none' }, noMemoryNote))
                return null
              }
              any = true
              return h(React.Fragment, { key: gr.key },
                gr.label ? h('h4', null, gr.label, ' ', h('span', null, gr.total)) : null,
                gr.items.map((n) => pill(n, ci)),
                gr.ghosts.map((x) => ghost(x, ci)),
                gr.hidden > 0 ? h('button', { type: 'button', className: 'kbat-more', onClick: () => p.onExpand(gr.key) }, gr.open ? 'Show fewer' : 'Show ' + gr.hidden + ' more') : null,
                gr.kind === 'lesson' && focusNode.kind === 'kyber' && focusNode.olderLessons > 0 ? h('p', { className: 'kbat-none' }, focusNode.olderLessons + ' older lessons are not shown.') : null)
            })
            const empty = !any && !c.groups.some((gr) => gr.kind === 'memory' && gr.total === 0)
            return h('div', { key: c.title, className: 'kbat-col' }, h('h3', null, c.title), groups, empty ? h('p', { className: 'kbat-none' }, 'Nothing here.') : null)
          })))
    }

    function DetailCard (p) {
      const g = p.graph; const x = p.extra
      const n = g.byId[p.id] || (x && x.byId[p.id]); if (!n) return null
      const area = g.areas.filter((a) => a.id === n.area)[0]
      const nb = Array.from((x && x.adj[n.id]) || g.adj[n.id] || []).map((i) => g.byId[i] || (x && x.byId[i])).filter(Boolean).sort(byKindThenLabel)
      const hub = n.kind === 'area' || n.kind === 'kyber'
      const isPath = ['area', 'kyber', 'lesson', 'skill', 'routine', 'root'].indexOf(n.kind) >= 0
      const copy = () => { try { navigator.clipboard.writeText(isPath ? n.path : n.id).then(() => p.onToast('Copied'), () => p.onToast('Copy is blocked here. Select the text instead.')) } catch (e) { p.onToast('Copy is blocked here. Select the text instead.') } }
      return h('div', { className: 'kbat-card' + (p.float ? ' kbat-float' : ''), 'data-kb': 'atlas-card' },
        h('button', { type: 'button', className: 'kbat-x', 'aria-label': 'Close details', onClick: p.onClose }, '×'),
        h('h3', null, h(Glyph, { kind: n.kind, color: areaVar(g, n), size: 14 }), h('span', null, n.label)),
        h('div', { className: 'kbat-meta' }, h('span', { className: 'kbat-pill' }, KIND_NAME_ALL[n.kind]),
          area && n.kind !== 'area' ? h('span', { className: 'kbat-pill' }, h('svg', { width: 8, height: 8, 'aria-hidden': 'true' }, h('circle', { cx: 4, cy: 4, r: 4, style: { fill: 'var(--kbat-p' + area.idx + ')' } })), area.label) : null,
          n.run ? h('span', { className: 'kbat-pill' }, n.run.ok ? 'Finished' : 'Failed') : null),
        h('p', { className: 'kbat-note' }, n.note),
        n.problem ? h('div', { className: 'kbat-callout', 'data-sev': n.problem.sev, role: 'note' }, h('span', { style: { color: n.problem.sev === 'err' ? 'var(--dsw-alias-state-error-primary,#ec1313)' : 'var(--dsw-alias-state-warn-primary,#f59e0b)' } }, h(Glyph, { kind: 'warn', size: 12 })), h('span', null, n.problem.text)) : null,
        h('dl', { className: 'kbat-kv' }, h('dt', null, isPath ? 'Path' : 'Source'), h('dd', { className: 'kbat-mono' }, n.path), h('dt', null, 'Changed'), h('dd', null, n.days === null ? 'Not recorded' : ago(n.days))),
        nb.length && !p.hideLinked ? h('div', { className: 'kbat-meta' }, nb.slice(0, 6).map((y) => h('button', { key: y.id, type: 'button', className: 'kbat-pill', onClick: () => p.onGo(y.id) }, h(Glyph, { kind: y.kind, color: areaVar(g, y), size: 10 }), y.label)), nb.length > 6 ? h('span', { className: 'kbat-pill' }, '+' + (nb.length - 6) + ' more') : null) : null,
        h('div', { className: 'kbat-acts' },
          hub && !(p.tab === 'around' && p.focus === n.id) ? h('button', { type: 'button', className: 'kbat-btn', onClick: () => p.onFocus(n.id) }, 'Show around this') : null,
          p.onFly ? h('button', { type: 'button', className: 'kbat-btn', onClick: p.onFly }, 'Centre') : null,
          h('button', { type: 'button', className: 'kbat-btn', onClick: copy }, isPath ? 'Copy path' : 'Copy id')),
        h('p', { className: 'kbat-ro' }, 'Read-only. The Atlas never edits your files.'))
    }

    function ToCheck (p) {
      const items = p.graph.problems
      return h('details', { className: 'kbat-tc', open: typeof window !== 'undefined' && window.innerWidth > 900, 'data-kb': 'atlas-tocheck' },
        h('summary', null, h('span', null, 'To check'), h('span', { className: 'kbat-count', 'data-zero': items.length === 0 ? '1' : undefined }, items.length)),
        h('p', null, 'Broken links, and things that look wrong.'),
        items.length === 0 ? h('p', null, 'Nothing to check. Every reference points somewhere and nothing failed.') : h('ul', null, items.map((n) => h('li', { key: n.id }, h('button', { type: 'button', onClick: () => p.onShow(n.id) },
          h('span', { className: 'kbat-ic', 'data-sev': n.problem.sev }, h(Glyph, { kind: 'warn', size: 14 })),
          h('span', { className: 'kbat-tx' }, h('b', null, n.label, h('u', null, KIND_NAME[n.kind])), h('i', null, n.problem.text)))))),
        p.notes.length ? h('p', null, p.notes.join(' ')) : null)
    }

    function ListView (p) {
      const g = p.graph; const fp = React.useState(''); const q = fp[0]; const setQ = fp[1]
      const rows = React.useMemo(() => listRows(g, q), [g, q])
      return h('div', { className: 'kbat-list' },
        h('div', { className: 'kbat-listbar' }, h('input', { className: 'kbat-filter', type: 'search', value: q, placeholder: 'Filter by name, note or path', 'aria-label': 'Filter the list', onChange: (e) => setQ(e.target.value) }), h('span', { className: 'kbat-ro' }, rows.length + ' of ' + g.nodes.length)),
        h('table', null, h('thead', null, h('tr', null, ['Name', 'Kind', 'Project', 'Links', 'Changed'].map((x) => h('th', { key: x }, x)))),
          h('tbody', null, rows.length === 0 ? h('tr', null, h('td', { colSpan: 5, style: { padding: 24, color: 'var(--dsw-alias-label-tertiary)' } }, 'Nothing matches.')) : rows.map((n) => {
            const area = n.kind === 'area' ? null : g.areas.filter((a) => a.id === n.area)[0]
            return h('tr', { key: n.id, 'data-row': n.id, tabIndex: 0, 'aria-selected': String(p.sel === n.id), onClick: () => p.onSelect(n.id), onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onSelect(n.id) } } },
              h('td', null, h('span', { className: 'kbat-nm' }, h(Glyph, { kind: n.kind, color: areaVar(g, n) }), n.label), n.problem ? h('span', { className: 'kbat-flag', 'data-sev': n.problem.sev }, n.problem.sev === 'err' ? 'Broken link' : 'Check') : null),
              h('td', null, KIND_NAME[n.kind]), h('td', null, area ? area.label : '—'), h('td', { style: { fontVariantNumeric: 'tabular-nums' } }, n.deg), h('td', { style: { fontVariantNumeric: 'tabular-nums' } }, ago(n.days)))
          }))))
    }

    function SourceList (p) {
      return h('ul', { className: 'kbat-srcs' }, SOURCES.map((s) => {
        const st = p.status[s[0]] || { state: 'waiting', count: null, note: '' }
        const bad = st.state === 'failed'
        const txt = st.state === 'ok' ? st.count + ' read' : st.state === 'skipped' ? st.note : st.state === 'reading' ? 'reading…' : bad ? 'no answer' : 'waiting'
        return h('li', { key: s[0], 'data-bad': bad ? '1' : undefined, title: bad ? st.note : undefined },
          h('span', { style: { width: 14, display: 'inline-flex', justifyContent: 'center', color: bad ? 'var(--dsw-alias-state-error-primary,#ec1313)' : st.state === 'ok' ? 'var(--dsw-alias-state-success-primary,#22c55e)' : 'var(--dsw-alias-label-tertiary)' } }, bad ? h(Glyph, { kind: 'warn', size: 12 }) : st.state === 'ok' ? '✓' : st.state === 'reading' ? h('span', { className: 'kbat-dot', 'data-t': 'busy', style: { width: 12, height: 12 } }) : '·'),
          h('span', null, s[1]), h('span', { className: 'kbat-s' }, txt))
      }))
    }

    // The whole-workspace canvas. React owns the element and the props; the engine owns every frame.
    function CanvasView (p) {
      const cvRef = React.useRef(null); const boxRef = React.useRef(null)
      const eng = React.useRef(null); if (eng.current === null) eng.current = newEngine()
      const e = eng.current
      const tp = React.useState(null); const tip = tp[0]; const setTip = tp[1]
      e.props = { sel: p.sel, names: p.names, motion: p.motion, iso: p.iso, query: low(p.query), inferred: p.inferred, full: p.full }
      const lastModel = React.useRef(null)
      React.useEffect(() => {
        const cv = cvRef.current; const box = boxRef.current
        e.cv = cv; e.ctx = cv.getContext('2d')
        const size = () => { const r = box.getBoundingClientRect(); engSize(e, r.width, r.height) }
        let ro = null
        if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(size); ro.observe(box) }
        size()
        const wheel = (ev) => {
          if (!(ev.ctrlKey || ev.metaKey || e.props.full)) return
          ev.preventDefault()
          const r = cv.getBoundingClientRect(); engZoom(e, Math.exp(-ev.deltaY * 0.0018), ev.clientX - r.left, ev.clientY - r.top)
        }
        cv.addEventListener('wheel', wheel, { passive: false })
        engColors(e, box)
        let timer = 0
        const mo = typeof MutationObserver === 'function' ? new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => engColors(e, box), 30) }) : null
        if (mo) mo.observe(document.body, { attributes: true })
        let raf = 0
        const loop = (t) => { try { engFrame(e, t) } catch (x) { /* a bad frame must not break the page */ } raf = requestAnimationFrame(loop) }
        raf = requestAnimationFrame(loop)
        p.apiRef.current = { fit: () => engFit(e, false), zoom: (f) => engZoom(e, f), fly: (id) => engFly(e, id, 1.6) }
        return () => { cancelAnimationFrame(raf); clearTimeout(timer); if (ro) ro.disconnect(); if (mo) mo.disconnect(); cv.removeEventListener('wheel', wheel); p.apiRef.current = null }
      }, [])
      React.useEffect(() => {
        e.model = p.data.model; e.lay = p.data.lay; e.view = p.view; e.follow = null
        const fresh = lastModel.current !== p.data.model
        lastModel.current = p.data.model
        engTargets(e, 0)
        if (fresh) for (const n of e.model.nodes) { n.x = n.tx * 0.25; n.y = n.ty * 0.25 } // the drawing opens from the middle
        engFit(e, false); e.dirty = true
      }, [p.data, p.view])
      React.useEffect(() => { e.dirty = true }, [p.sel, p.names, p.motion, p.iso, p.query, p.inferred])
      const rel = (ev) => { const r = cvRef.current.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top] }
      const down = (ev) => { try { cvRef.current.setPointerCapture(ev.pointerId) } catch (x) { /* synthetic event */ } const q = rel(ev); e.drag = { x: q[0], y: q[1], cx: e.camT.x, cy: e.camT.y, rot: e.rot, tilt: e.tilt, moved: false } }
      const move = (ev) => {
        const q = rel(ev)
        if (e.drag) {
          const dx = q[0] - e.drag.x; const dy = q[1] - e.drag.y
          if (Math.abs(dx) + Math.abs(dy) > 4) e.drag.moved = true
          if (e.drag.moved) {
            e.follow = null; setTip(null)
            if (e.view === 'orbit') { e.rot = e.drag.rot + dx * 0.006; e.tilt = clampN(e.drag.tilt - dy * 0.004, -0.3, 1.2) } else { e.camT.x = e.cam.x = e.drag.cx - dx / e.cam.k; e.camT.y = e.cam.y = e.drag.cy - dy / e.cam.k }
            e.dirty = true
          }
          return
        }
        const n = engHit(e, q[0], q[1])
        if ((n && n.id) !== e.hover) { e.hover = n ? n.id : null; e.dirty = true }
        setTip(n ? { x: Math.min(q[0] + 14, Math.max(0, e.W - 250)), y: Math.min(q[1] + 14, Math.max(0, e.H - 60)), n } : null)
      }
      const up = (ev) => { const q = rel(ev); if (e.drag && !e.drag.moved) { const n = engHit(e, q[0], q[1]); p.onSelect(n ? n.id : null) } e.drag = null }
      const leave = () => { if (!e.drag) { e.hover = null; setTip(null); e.dirty = true } }
      const areaOf = (n) => (n.area && n.kind !== 'area' ? p.data.model.areas.filter((a) => a.id === n.area)[0] : null)
      return h('div', { ref: boxRef, style: { position: 'absolute', inset: 0 } },
        h('canvas', { ref: cvRef, className: 'kbat-canvas', 'data-hot': tip ? '1' : undefined, role: 'img', 'aria-label': 'A drawing of your workspace. The List view has the same things as text.', onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerLeave: leave }),
        tip ? h('div', { className: 'kbat-tip', style: { left: tip.x, top: tip.y } }, h('b', null, tip.n.label), h('span', null, KIND_NAME_ALL[tip.n.kind] + (areaOf(tip.n) ? ' · ' + areaOf(tip.n).label : '') + ' · ' + tip.n.deg + (tip.n.deg === 1 ? ' link' : ' links'))) : null)
    }

    // Search (with a result list that flies to the node), plus the toggles of the canvas views.
    function CanvasTools (p) {
      const m = p.model
      const op = React.useState(false); const open = op[0]; const setOpen = op[1]
      const ip = React.useState(0); const idx = ip[0]; const setIdx = ip[1]
      const q = low(p.query)
      const results = React.useMemo(() => (q === '' ? [] : m.nodes.filter((n) => (n.label + ' ' + n.path + ' ' + n.note).toLowerCase().indexOf(q) >= 0).sort((a, b) => b.deg - a.deg).slice(0, 7)), [m, q])
      const pick = (id) => { setOpen(false); p.onPick(id) }
      return h(React.Fragment, null,
        h('div', { className: 'kbat-search' },
          h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': 'true' }, h('circle', { cx: 6, cy: 6, r: 4.2 }), h('path', { d: 'M9.2 9.2 12.5 12.5' })),
          h('input', {
            type: 'search', value: p.query, placeholder: 'Search name, path or note', 'aria-label': 'Search the drawing', role: 'combobox', 'aria-expanded': String(open && results.length > 0),
            onChange: (ev) => { p.setQuery(ev.target.value); setOpen(true); setIdx(0) }, onFocus: () => setOpen(true), onBlur: () => setTimeout(() => setOpen(false), 120),
            onKeyDown: (ev) => {
              if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { if (results.length) { ev.preventDefault(); setIdx((idx + (ev.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length) } } else if (ev.key === 'Enter' && results[idx]) { ev.preventDefault(); pick(results[idx].id) } else if (ev.key === 'Escape' && p.query !== '') { ev.preventDefault(); ev.stopPropagation(); p.setQuery(''); setOpen(false) }
            }
          }),
          open && q !== '' ? h('ul', { className: 'kbat-results', role: 'listbox' }, results.length === 0 ? h('li', { className: 'kbat-none2' }, 'No match for “' + p.query.trim() + '”') : results.map((n, i) => h('li', { key: n.id, role: 'option', 'aria-selected': String(i === idx), onMouseDown: (ev) => { ev.preventDefault(); pick(n.id) } }, h(Glyph, { kind: n.kind, color: areaVar(p.graph, n) }), h('span', null, n.label), h('span', { className: 'kbat-sub2' }, KIND_NAME_ALL[n.kind])))) : null),
        h('button', { type: 'button', className: 'kbat-btn', 'aria-pressed': String(p.names), onClick: () => p.setNames(!p.names) }, 'Names'),
        h('button', { type: 'button', className: 'kbat-btn', 'aria-pressed': String(p.motion), onClick: () => p.setMotion(!p.motion) }, 'Motion'),
        h('button', { type: 'button', className: 'kbat-btn', 'aria-pressed': String(p.lessons), title: 'Lessons are many; they are left out unless you ask', onClick: () => p.setLessons(!p.lessons) }, 'Lessons'),
        h('button', { type: 'button', className: 'kbat-btn', onClick: p.onFit }, 'Fit'),
        h('button', { type: 'button', className: 'kbat-btn', onClick: p.onFull }, p.full ? 'Exit full screen' : 'Full screen'))
    }

    // Click a chip to isolate it; click again to clear. The dashed-lines chip is a plain toggle.
    function Legend (p) {
      const m = p.model; const g = p.graph
      const chip = (key, label, glyph, count, k, v, extra) => h('button', { key, type: 'button', className: 'kbat-chip', 'data-check': extra && extra.check ? '1' : undefined, disabled: extra && extra.disabled, title: extra && extra.title, 'aria-pressed': String(!!p.iso && p.iso.k === k && p.iso.v === v), onClick: () => p.setIso(p.iso && p.iso.k === k && p.iso.v === v ? null : { k, v }) }, glyph, label, ' ', h('span', { className: 'kbat-n' }, count))
      const lessonTotal = g.nodes.filter((n) => n.kind === 'lesson').length
      return h('div', { className: 'kbat-legend', 'aria-label': 'Legend: click to isolate' },
        h('div', { className: 'kbat-lrow' }, h('span', { className: 'kbat-lbl' }, 'Projects'),
          m.areas.map((a) => chip('a' + a.id, a.label, h('svg', { width: 10, height: 10, 'aria-hidden': 'true' }, h('circle', { cx: 5, cy: 5, r: 5, style: { fill: 'var(--kbat-p' + a.idx + ')' } })), m.areaCount[a.id] || 0, 'area', a.id)),
          chip('chk', 'To check', h(Glyph, { kind: 'warn', size: 12 }), m.problemCount, 'problem', '1', { check: true })),
        h('div', { className: 'kbat-lrow' }, h('span', { className: 'kbat-lbl' }, 'Kinds'),
          ['area', 'kyber', 'memory', 'lesson', 'skill', 'routine', 'app', 'run'].map((k) => (k === 'lesson' && !p.lessons
            ? chip('k' + k, KIND_NAME_ALL[k], h(Glyph, { kind: k, color: 'currentColor' }), lessonTotal, 'kind', k, { disabled: true, title: 'Hidden. Use the Lessons button.' })
            : chip('k' + k, KIND_NAME_ALL[k], h(Glyph, { kind: k, color: 'currentColor' }), m.kindCount[k] || 0, 'kind', k))),
          h('button', { type: 'button', className: 'kbat-chip', 'aria-pressed': String(p.inferred), title: 'Links that come from a name match, not from a field', onClick: () => p.setInferred(!p.inferred) }, h('svg', { width: 18, height: 8, 'aria-hidden': 'true' }, h('path', { d: 'M1 4h16', stroke: 'currentColor', strokeWidth: 1.4, strokeDasharray: '3 3' })), 'Inferred links')))
    }

    const TABS = [['around', 'Around'], ['rings', 'Rings'], ['circle', 'Circle'], ['areas', 'Areas'], ['links', 'Links'], ['timeline', 'Timeline'], ['orbit', 'Orbit'], ['list', 'List']]
    const CAPTION = {
      rings: ['Rings. ', 'One ring per layer, the workspace in the middle. Each project keeps the same wedge on every ring.'],
      circle: ['Circle. ', 'Every node on one ring, grouped by project. Links cross the middle.'],
      areas: ['Areas. ', 'One cluster per project. Lines between clusters show what crosses projects.'],
      links: ['Links. ', 'Nodes pulled together by what they reference. Loose ends drift to the edge.'],
      timeline: ['Timeline. ', 'Top: automation runs of the last 14 days. Bottom: things by last change. Colour is the project.'],
      orbit: ['Orbit. ', 'The rings as a stack that turns on its own. Drag to turn it yourself.']
    }

    function Atlas (p) {
      const sp = React.useState({ phase: 'loading', status: {}, result: null }); const st = sp[0]; const setSt = sp[1]
      const fp = React.useState(null); const focus = fp[0]; const setFocus = fp[1]
      const tp = React.useState('around'); const tab = tp[0]; const setTabRaw = tp[1]
      const selp = React.useState(null); const sel = selp[0]; const setSel = selp[1]
      const hp = React.useState(false); const help = hp[0]; const setHelp = hp[1]
      const ep = React.useState({}); const expanded = ep[0]; const setExpanded = ep[1]
      const tstp = React.useState(null); const toast = tstp[0]; const setToast = tstp[1]
      const nmp = React.useState(false); const names = nmp[0]; const setNames = nmp[1]
      const mop = React.useState(!reduced); const motion = mop[0]; const setMotion = mop[1]
      const lsp = React.useState(false); const lessons = lsp[0]; const setLessons = lsp[1]
      const inp = React.useState(true); const inferred = inp[0]; const setInferred = inp[1]
      const isp = React.useState(null); const iso = isp[0]; const setIso = isp[1]
      const qp = React.useState(''); const query = qp[0]; const setQuery = qp[1]
      const fup = React.useState(false); const full = fup[0]; const setFull = fup[1]
      const alive = React.useRef(true)
      const canvasApi = React.useRef(null)
      const panelRef = React.useRef(null)
      const cache = React.useRef({ g: null, lessons: null, data: null })
      const load = React.useCallback(() => {
        setSt((s) => ({ phase: 'loading', status: {}, result: s.result }))
        readAll(p.store, (status) => { if (alive.current) setSt((s) => ({ phase: 'loading', status, result: s.result })) }).then((r) => {
          if (!alive.current) return
          const failed = SOURCES.filter((s) => r.status[s[0]] && r.status[s[0]].state === 'failed').length
          const g = buildGraph(r.src, Date.now())
          setSt({ phase: failed === SOURCES.length ? 'error' : 'ready', status: r.status, result: { graph: g, src: r.src, at: Date.now(), failed } })
          setFocus((f) => (f !== null && g.byId[f] !== undefined ? f : defaultFocus(g)))
        }).catch((e) => { if (alive.current) setSt({ phase: 'error', status: {}, result: null }) })
      }, [p.store])
      React.useEffect(() => { poserCss(); alive.current = true; load(); return () => { alive.current = false } }, [load])
      React.useEffect(() => { if (toast === null) return undefined; const t = setTimeout(() => setToast(null), 2400); return () => clearTimeout(t) }, [toast])
      // Leaving full screen: Escape (captured, because the Settings dialog also closes on Escape) or the browser's own exit.
      React.useEffect(() => {
        if (!full) return undefined
        const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); setFull(false) } }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
      }, [full])
      React.useEffect(() => {
        const onChange = () => { if (!document.fullscreenElement) setFull(false) }
        document.addEventListener('fullscreenchange', onChange)
        return () => document.removeEventListener('fullscreenchange', onChange)
      }, [])
      const g = st.result ? st.result.graph : null
      const isCanvas = CANVAS_VIEWS.indexOf(tab) >= 0
      // The whole-workspace model is built the first time a drawing is asked for, then reused until the data or the Lessons toggle changes.
      let data = null
      if (g && isCanvas) {
        if (cache.current.g !== g || cache.current.lessons !== lessons) { const model = canvasModel(g, { lessons }); cache.current = { g, lessons, data: { model, lay: canvasLayouts(model) } } }
        data = cache.current.data
      }
      const nodeOf = (id) => (g && g.byId[id]) || (data && data.model.byId[id]) || null
      const setTab = (t) => {
        if (CANVAS_VIEWS.indexOf(t) < 0 && full) { setFull(false); try { if (document.fullscreenElement) document.exitFullscreen() } catch (e) { /* not in native full screen */ } }
        if (g && sel !== null && t !== 'around' && CANVAS_VIEWS.indexOf(t) < 0 && !g.byId[sel]) setSel(null) // root and runs exist only in the drawings
        setTabRaw(t)
      }
      const toggleFull = () => {
        const on = !full; setFull(on)
        const el = panelRef.current
        try {
          if (on && el && el.requestFullscreen) { const r = el.requestFullscreen(); if (r && r.catch) r.catch(() => { /* the CSS fallback is already on */ }) } else if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen()
        } catch (e) { /* the CSS fallback is enough */ }
      }
      const loading = st.phase === 'loading' && !g
      const partial = st.phase === 'ready' && g && (st.result.failed > 0 || SOURCES.some((s) => st.status[s[0]] && st.status[s[0]].state === 'skipped'))
      const failedNames = SOURCES.filter((s) => st.status[s[0]] && st.status[s[0]].state === 'failed').map((s) => s[1])
      const skippedMemory = st.status.memory && st.status.memory.state === 'skipped'
      const notes = []
      if (st.result && st.result.src.storeReady === false) notes.push('Sessions were not ready, so kybers are not tied to projects. Re-read in a moment.')
      if (skippedMemory) notes.push('Memories were not read, so any problem with them is not listed.')
      if (failedNames.length) notes.push(failedNames.join(', ') + (failedNames.length === 1 ? ' was' : ' were') + ' not read, so related problems are not listed.')
      const flyTo = (id) => { setTimeout(() => { if (canvasApi.current) canvasApi.current.fly(id) }, 40) }
      const showNode = (id) => {
        if (!g) return
        const n = g.byId[id]
        if (isCanvas) { if (n && n.kind === 'lesson' && !lessons) setLessons(true); setSel(id); flyTo(id); return }
        if (tab === 'list') { setSel(id); return }
        if (!n) return
        setTab('around')
        // keep the current focus when the node is already drawn around it; otherwise move to its hub
        if (focus !== null && g.byId[focus] && aroundSet(g, focus).has(id)) { setSel(id); return }
        const hub = hubOf(g, n); if (hub !== null) setFocus(hub)
        setSel(id)
        if (hub === null) setTab('list')
      }
      const builtTxt = loading ? 'Reading…' : st.phase === 'error' ? 'Could not read' : partial ? 'Read just now · ' + (SOURCES.length - failedNames.length - (skippedMemory ? 1 : 0)) + ' of ' + SOURCES.length + ' sources' : 'Read just now'
      const dotT = loading || st.phase === 'loading' ? 'busy' : st.phase === 'error' ? 'err' : partial ? 'warn' : undefined
      const empty = g && g.nodes.length === 0
      const card = (float) => (sel && nodeOf(sel) ? h(DetailCard, { graph: g, extra: data ? data.model : null, id: sel, tab, focus, float, hideLinked: tab === 'around', onClose: () => setSel(null), onGo: showNode, onFocus: (id) => { setFocus(id); setTab('around') }, onFly: isCanvas ? () => flyTo(sel) : null, onToast: setToast }) : null)
      let body
      if (loading) body = h('div', { className: 'kbat-state', role: 'status' }, h('h2', null, 'Reading the Atlas'), h('p', null, 'Reading seven sources on this computer. Nothing leaves it.'), h(SourceList, { status: st.status }))
      else if (st.phase === 'error') body = h('div', { className: 'kbat-state', role: 'alert' }, h('h2', null, 'The Atlas could not be read'), h('p', null, 'None of the sources answered. DSH may be restarting. Wait a moment, then try again.'), h(SourceList, { status: st.status }), h('button', { type: 'button', className: 'kbat-btn', 'data-primary': 'true', onClick: load }, 'Try again'))
      else if (empty) body = h('div', { className: 'kbat-state' }, h('h2', null, 'Nothing to map yet'), h('p', null, 'The Atlas fills in as you add kybers, skills, automations and memories. Create a kyber or install a skill, then come back and re-read.'))
      else {
        const cap = CAPTION[tab]
        body = h('div', { className: 'kbat-body' },
          h('aside', { className: 'kbat-rail' }, full ? null : card(false), h(ToCheck, { graph: g, notes, onShow: showNode })),
          h('div', { className: 'kbat-panel', ref: panelRef, 'data-full': full ? '1' : undefined },
            h('div', { className: 'kbat-tools' },
              tab === 'around' ? h(Picker, { graph: g, focus, onPick: (id) => { setFocus(id); setTab('around'); setSel(null) } }) : null,
              h('div', { className: 'kbat-seg', role: 'group', 'aria-label': 'View' }, TABS.map((t) => h('button', { key: t[0], type: 'button', 'aria-pressed': String(tab === t[0]), onClick: () => setTab(t[0]) }, t[1]))),
              isCanvas ? h(CanvasTools, { graph: g, model: data.model, query, setQuery, names, setNames, motion, setMotion, lessons, setLessons, full, onFit: () => { if (canvasApi.current) canvasApi.current.fit() }, onFull: toggleFull, onPick: showNode }) : null),
            isCanvas ? h(Legend, { graph: g, model: data.model, iso, setIso, inferred, setInferred, lessons }) : null,
            h('div', { className: 'kbat-stage', 'data-canvas': isCanvas ? '1' : undefined },
              tab === 'around' ? h(AroundView, { graph: g, focus, sel, expanded, onSelect: setSel, onExpand: (k) => setExpanded((e) => Object.assign({}, e, { [k]: e[k] !== true })) })
                : tab === 'list' ? h(ListView, { graph: g, sel, onSelect: setSel })
                  : h(React.Fragment, null,
                    h(CanvasView, { data, view: tab, sel, names, motion, iso, query, inferred, full, onSelect: setSel, apiRef: canvasApi }),
                    h('div', { className: 'kbat-cap2' }, h('b', null, cap[0]), cap[1]),
                    h('div', { className: 'kbat-count2' }, data.model.nodes.length + ' nodes · ' + data.model.links.filter((l) => !l.bad).length + ' links · ' + data.model.problemCount + ' to check'),
                    h('div', { className: 'kbat-hud' },
                      h('button', { type: 'button', className: 'kbat-btn kbat-icon', 'aria-label': 'Zoom in', onClick: () => { if (canvasApi.current) canvasApi.current.zoom(1.4) } }, '+'),
                      h('button', { type: 'button', className: 'kbat-btn kbat-icon', 'aria-label': 'Zoom out', onClick: () => { if (canvasApi.current) canvasApi.current.zoom(1 / 1.4) } }, '−'),
                      h('button', { type: 'button', className: 'kbat-btn kbat-icon', 'aria-label': 'Fit to screen', title: 'Fit to screen', onClick: () => { if (canvasApi.current) canvasApi.current.fit() } }, h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', 'aria-hidden': 'true' }, h('path', { d: 'M1.5 4.5v-3h3M7.5 1.5h3v3M10.5 7.5v3h-3M4.5 10.5h-3v-3' })))),
                    full ? card(true) : null))))
      }
      return h('div', { className: 'kbat-page', 'data-kb': 'atlas' },
        h('header', { className: 'kbat-head' },
          h('div', null, h('h1', { className: 'kbat-title' }, 'Atlas'), h('p', { className: 'kbat-sub' }, 'Every project, kyber, skill, memory, lesson, automation and app, and how they point to each other. It only reads; it never edits or stores anything.')),
          h('div', { className: 'kbat-headr' },
            h('span', { className: 'kbat-built', role: 'status' }, h('span', { className: 'kbat-dot', 'data-t': dotT }), builtTxt),
            h('button', { type: 'button', className: 'kbat-btn', onClick: () => setHelp(true), 'aria-haspopup': 'dialog' }, 'Help'),
            h('button', { type: 'button', className: 'kbat-btn', onClick: load, disabled: st.phase === 'loading' }, 'Re-read'))),
        partial ? h('div', { className: 'kbat-banner', role: 'status' }, h('span', { className: 'kbat-dot', 'data-t': 'warn' }), h('span', { className: 'kbat-sp' },
          skippedMemory && failedNames.length === 0 ? h(React.Fragment, null, h('b', null, 'Memories were skipped. '), 'They live in your kybernos.app account, which is not linked. The other sources were read.')
            : h(React.Fragment, null, h('b', null, failedNames.join(', ') + ' did not answer. '), 'The rest is shown.')),
          failedNames.length ? h('button', { type: 'button', className: 'kbat-btn', onClick: load }, 'Try again') : null) : null,
        body,
        help ? h(HelpDialog, { onClose: () => setHelp(false) }) : null,
        toast ? h('div', { role: 'status', style: { position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 2147483001, padding: '8px 14px', borderRadius: 16, background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-label-primary-foreground,#fff)', fontSize: 12 } }, toast) : null)
    }

    // ══ 4. REGISTRATION ══════════════════════════════════════════════════════
    // The entry contract: declare the services the context must expose. Without
    // `slots` the entry would stay "loading" (see kybernos-maintenance).
    const model = {
      inject: ['slots', 'uiWorkspace'],
      apply (ctx) {
        try {
          const slots = ctx.get ? ctx.get('slots') : ctx.slots
          if (slots === undefined || slots === null) { try { console.error('[kybernos-atlas] slots service unavailable: no interface') } catch (e) { /* */ } return }
          let store = null
          try { store = ctx.get('uiWorkspace') || null } catch (e) { store = null }
          if (!React) return
          slots.inject('settings.section', () => slots.register(
            { name: 'settings.section', id: 'kybernos-atlas', order: 15, label: 'Atlas' },
            () => h(Atlas, { store })))
        } catch (e) {
          // A bundle must never stop DSH from starting.
          try { console.error('[kybernos-atlas] could not register the page: ' + (e && e.message ? e.message : e)) } catch (e2) { /* */ }
        }
      }
    }
    Object.defineProperty(model, '__test', {
      enumerable: false,
      value: { normSkills, normLoad, normState, normMemory, normTasks, normApps, normWorkspaces, buildGraph, hubOf, aroundSet, aroundModel, listRows, pickerItems, defaultFocus, daysSince, ago, cut, firstSentence, canvasModel, canvasLayouts, runForce, CANVAS_VIEWS, LAYERS, RING_R, TL, tlx }
    })
    return model
  }
})
