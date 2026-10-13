// kybernos-dashboards: the pure model. No DOM, no disk, no DSH, no clock of its own, no import (the browser build pastes
// this file in as it is, so the very code the Node tests run is the code the page runs).
//
// A dashboard is DATA, never code. It is a list of widgets; a widget names a SOURCE (a provider of this catalogue, with a
// few parameters) and says how to show what the source returns. Everything below is deterministic and total: a damaged
// file never throws, it loses the part that is wrong and says so.
//
// Layout of this file:
//   1. small helpers                      4. validate / compact / inspect a dashboard
//   2. the provider catalogue             5. query: where, group, aggregate, sort
//   3. the widget catalogue               6. shapers: table + widget -> what a renderer draws

// ── 1. helpers ───────────────────────────────────────────────────────────────

export const KIND = 'dashboard'
export const VERSION = 1
export const LIMITS = { widgets: 24, title: 120, desc: 240, text: 4000, items: 40, cols: 6, cards: 40, nodes: 14, edges: 24, name: 60, doc: 400000, stages: 3 }

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const arr = (v) => (Array.isArray(v) ? v : [])
const obj = (v) => (isObj(v) ? v : {})
const str = (v) => (typeof v === 'string' ? v : '')
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const cut = (s, n) => { const t = String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t }
const clampInt = (v, lo, hi, d) => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d }

/** A short lower-case id: letters, digits and hyphens. */
export const slug = (s, fallback = 'dashboard') => {
  const out = String(s === undefined || s === null ? '' : s).toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, LIMITS.name)
  return out === '' ? fallback : out
}

const DAY = 86400000
/** Local calendar day as YYYY-MM-DD. */
export const dayKey = (ms) => {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
const toMs = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v !== '') { const t = Date.parse(v); if (!Number.isNaN(t)) return t }
  return null
}
const lastDays = (n, nowMs) => { const out = []; for (let i = n - 1; i >= 0; i--) out.push(dayKey(nowMs - i * DAY)); return out }

// ── 2. the provider catalogue ────────────────────────────────────────────────
//
// A provider turns one or two same-origin routes into a TABLE: { columns: [{ id, label, type }], rows: [{...}], meta }.
// `routes(params, now)` lists the requests the page makes; `build(parts, params, now)` turns the answers (by route key) into the table.
// Types: 'string' | 'number' | 'date' (YYYY-MM-DD) | 'time' (ISO) | 'state'.
// States, everywhere: done | failed | queued | upcoming | paused | none.

const col = (id, label, type) => ({ id, label, type })
const table = (columns, rows, meta) => ({ columns, rows, meta: Object.assign({ note: '', xDomain: null }, meta || {}) })
const modelKey = (k) => { const i = String(k).indexOf('/'); return i < 0 ? { provider: '', model: String(k) } : { provider: String(k).slice(0, i), model: String(k).slice(i + 1) } }

function runStatus (s) {
  const v = str(s).toLowerCase()
  if (v === 'error' || v === 'failed' || v === 'fail') return 'failed'
  if (v === 'fired' || v === 'done' || v === 'ok' || v === 'success') return 'done'
  if (v === 'queued' || v === 'pending') return 'queued'
  return v === '' ? 'none' : v
}
const taskRows = (json) => arr(obj(json).tasks).filter((t) => isObj(t) && typeof t.id === 'string')
function scheduleText (s) {
  if (typeof s === 'string') return s
  const o = obj(s)
  if (str(o.cron) !== '') return 'cron ' + o.cron
  if (str(o.at) !== '') return 'once ' + o.at
  return str(o.mode)
}

export const PROVIDERS = {
  'usage.daily': {
    label: 'Tokens per day and model',
    about: 'Tokens used by your own keys and local models, one row per day and model. Money is not stored: tokens are.',
    params: { days: 'number 1..120, default 14' },
    period: true,
    columns: [col('day', 'Day', 'date'), col('model', 'Model', 'string'), col('provider', 'Provider', 'string'), col('tokens', 'Tokens', 'number'), col('input', 'Input tokens', 'number'), col('output', 'Output tokens', 'number'), col('cache_read', 'Cache read tokens', 'number'), col('cache_write', 'Cache write tokens', 'number')],
    routes: (p) => [{ key: 'summary', method: 'GET', path: '/kybernos-usage/summary?days=' + clampInt(p.days, 1, 120, 14) }],
    build: (parts, p) => {
      const j = obj(parts.summary)
      const rows = []
      for (const d of arr(j.daily)) {
        const models = obj(obj(d).models)
        for (const k of Object.keys(models)) {
          const t = obj(models[k])
          const u = num(t.u); const o = num(t.o); const cr = num(t.cr); const cw = num(t.cw)
          const m = modelKey(k)
          rows.push({ day: str(d.day), model: m.model, provider: m.provider, tokens: u + o + cr + cw, input: u, output: o, cache_read: cr, cache_write: cw })
        }
      }
      const days = arr(j.daily).map((d) => str(obj(d).day)).filter((d) => d !== '')
      return table(PROVIDERS['usage.daily'].columns, rows, { xDomain: { field: 'day', values: days }, note: obj(j.before) && Object.keys(obj(j.before)).length > 0 ? 'Usage before the first measure is not dated and is not shown.' : '' })
    },
  },
  'usage.sessions': {
    label: 'Tokens per session',
    about: 'The sessions that used tokens in the period, newest first (up to 40).',
    params: { days: 'number 1..120, default 14' },
    period: true,
    columns: [col('session', 'Session', 'string'), col('title', 'Title', 'string'), col('seen', 'Last seen', 'time'), col('day', 'Day', 'date'), col('tokens', 'Tokens', 'number'), col('models', 'Models used', 'number')],
    routes: (p) => [{ key: 'summary', method: 'GET', path: '/kybernos-usage/summary?days=' + clampInt(p.days, 1, 120, 14) }],
    build: (parts) => {
      const rows = arr(obj(parts.summary).sessions).filter(isObj).map((s) => {
        const ms = obj(s.models)
        let tokens = 0
        for (const k of Object.keys(ms)) { const t = obj(ms[k]); tokens += num(t.u) + num(t.o) + num(t.cr) + num(t.cw) }
        const at = toMs(s.seen)
        return { session: str(s.id), title: cut(s.title, 80) || str(s.id).slice(0, 8), seen: str(s.seen), day: at === null ? '' : dayKey(at), tokens, models: Object.keys(ms).length }
      })
      return table(PROVIDERS['usage.sessions'].columns, rows)
    },
  },
  'automations.runs': {
    label: 'Automation runs',
    about: 'Past runs of your automations (the last 20 of each), one row per run.',
    params: { days: 'number 1..45, default 14' },
    period: true,
    columns: [col('automation', 'Automation', 'string'), col('id', 'Automation id', 'string'), col('at', 'Started', 'time'), col('day', 'Day', 'date'), col('hour', 'Hour', 'number'), col('state', 'State', 'state'), col('error', 'Error', 'string'), col('session', 'Session', 'string'), col('runs', 'Runs', 'number')],
    routes: () => [{ key: 'tasks', method: 'POST', path: '/kybernos/tasks', body: { action: 'list' } }],
    build: (parts, p, now) => {
      const days = clampInt(p.days, 1, 45, 14)
      const since = now - days * DAY
      const rows = []
      for (const t of taskRows(parts.tasks)) {
        for (const h of arr(t.history)) {
          const at = toMs(obj(h).at)
          if (at === null || at < since || at > now + DAY) continue
          rows.push({ automation: cut(t.name, 80) || t.id, id: t.id, at: new Date(at).toISOString(), day: dayKey(at), hour: new Date(at).getHours(), state: runStatus(obj(h).status), error: cut(obj(h).error, 120), session: str(obj(h).sessionId), runs: 1 })
        }
      }
      rows.sort((a, b) => (a.at < b.at ? 1 : -1))
      return table(PROVIDERS['automations.runs'].columns, rows, { xDomain: { field: 'day', values: lastDays(days, now) }, note: 'Each automation keeps its last 20 runs.' })
    },
  },
  'automations.list': {
    label: 'Automations',
    about: 'One row per automation with its schedule and the result of its last run.',
    params: {},
    period: false,
    columns: [col('name', 'Automation', 'string'), col('id', 'Id', 'string'), col('schedule', 'Schedule', 'string'), col('active', 'Active', 'string'), col('state', 'Last run', 'state'), col('last', 'Last run at', 'time'), col('runs', 'Runs kept', 'number'), col('failed', 'Failed runs kept', 'number')],
    routes: () => [{ key: 'tasks', method: 'POST', path: '/kybernos/tasks', body: { action: 'list' } }],
    build: (parts) => {
      const rows = taskRows(parts.tasks).map((t) => {
        const hist = arr(t.history).filter(isObj).slice().sort((a, b) => (toMs(b.at) || 0) - (toMs(a.at) || 0))
        const last = hist[0]
        const active = t.active !== false
        const state = !active ? 'paused' : (last === undefined ? 'none' : runStatus(last.status))
        return { name: cut(t.name, 80) || t.id, id: t.id, schedule: scheduleText(t.schedule), active: active ? 'yes' : 'no', state, last: last === undefined ? '' : str(last.at), runs: hist.length, failed: hist.filter((h) => runStatus(h.status) === 'failed').length }
      })
      return table(PROVIDERS['automations.list'].columns, rows)
    },
  },
  'automations.timeline': {
    label: 'Automations this week',
    about: 'Past runs and planned runs of the scheduled automations over one week (Monday to Sunday), one row per run.',
    params: { weekOffset: 'number -4..4, default 0 (0 = this week)' },
    period: false,
    columns: [col('automation', 'Automation', 'string'), col('id', 'Id', 'string'), col('at', 'At', 'time'), col('day', 'Day', 'date'), col('hour', 'Hour', 'number'), col('state', 'State', 'state'), col('error', 'Error', 'string')],
    weekOf: (now, offset) => {
      const d = new Date(now)
      const dow = (d.getDay() + 6) % 7
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow + clampInt(offset, -4, 4, 0) * 7)
      return { from: monday.getTime(), to: monday.getTime() + 7 * DAY }
    },
    routes: (p, now) => {
      const w = PROVIDERS['automations.timeline'].weekOf(now, p.weekOffset)
      return [
        { key: 'tasks', method: 'POST', path: '/kybernos/tasks', body: { action: 'list' } },
        { key: 'occurrences', method: 'GET', path: '/kybernos/tasks/occurrences?from=' + encodeURIComponent(new Date(Math.max(w.from, now)).toISOString()) + '&to=' + encodeURIComponent(new Date(w.to).toISOString()), optional: w.to <= now },
      ]
    },
    build: (parts, p, now) => {
      const w = PROVIDERS['automations.timeline'].weekOf(now, p.weekOffset)
      const tasks = taskRows(parts.tasks)
      const nameOf = {}
      for (const t of tasks) nameOf[t.id] = cut(t.name, 80) || t.id
      const rows = []
      const push = (id, at, state, error) => { rows.push({ automation: nameOf[id] || id, id, at: new Date(at).toISOString(), day: dayKey(at), hour: new Date(at).getHours(), state, error: error || '' }) }
      for (const t of tasks) {
        for (const h of arr(t.history)) { const at = toMs(obj(h).at); if (at !== null && at >= w.from && at < w.to) push(t.id, at, runStatus(obj(h).status), cut(obj(h).error, 120)) }
      }
      for (const o of arr(obj(parts.occurrences).occurrences)) {
        const at = toMs(obj(o).at)
        if (at !== null && at >= w.from && at < w.to && at > now - 60000 && typeof o.id === 'string') push(o.id, at, 'upcoming', '')
      }
      rows.sort((a, b) => (a.at < b.at ? -1 : 1))
      return table(PROVIDERS['automations.timeline'].columns, rows, { xDomain: { field: 'day', values: [0, 1, 2, 3, 4, 5, 6].map((i) => dayKey(w.from + i * DAY + 3600000)) }, note: 'Planned runs come from the scheduler. A paused automation is not planned.' })
    },
  },
  'teams.list': {
    label: 'Agent Teams',
    about: 'The Agent Teams you defined, with their roles, skills and tools.',
    params: {},
    period: false,
    columns: [col('team', 'Agent Team', 'string'), col('id', 'Id', 'string'), col('category', 'Category', 'string'), col('mission', 'Mission', 'string'), col('roles', 'Roles', 'number'), col('skills', 'Declared skills', 'number'), col('tools', 'Tools', 'number')],
    routes: () => [{ key: 'load', method: 'GET', path: '/kybernos/load' }],
    build: (parts) => {
      const seen = new Set()
      const rows = []
      for (const root of arr(obj(parts.load).roots)) {
        for (const k of arr(obj(root).kybers)) {
          const id = str(obj(k).id).toLowerCase()
          if (id === '' || seen.has(id)) continue
          seen.add(id)
          const ui = obj(k.ui)
          const tools = arr(k.roles).reduce((a, r) => a + arr(obj(r).tools).length, 0)
          rows.push({ team: cut(ui.name, 60) || id, id, category: cut(ui.category, 40), mission: cut(k.mission, 140), roles: arr(k.roles).length, skills: arr(k.skillsDeclared).length, tools })
        }
      }
      return table(PROVIDERS['teams.list'].columns, rows)
    },
  },
  'teams.lessons': {
    label: 'Lessons per Agent Team',
    about: 'What each Agent Team has learned and how often it ran.',
    params: {},
    period: false,
    columns: [col('team', 'Agent Team', 'string'), col('lessons', 'Lessons', 'number'), col('runs', 'Runs', 'number'), col('last', 'Last activity', 'time')],
    routes: () => [{ key: 'state', method: 'GET', path: '/kybernos-sessions/state' }],
    build: (parts) => {
      const rows = arr(obj(parts.state).kybers).filter((k) => isObj(k) && typeof k.id === 'string').map((k) => ({
        team: k.id, lessons: typeof k.totalLecons === 'number' ? k.totalLecons : arr(k.lecons).length, runs: typeof k.totalRuns === 'number' ? k.totalRuns : 0, last: k.derniereActivite === undefined || k.derniereActivite === null ? '' : String(k.derniereActivite),
      }))
      return table(PROVIDERS['teams.lessons'].columns, rows)
    },
  },
  'skills.list': {
    label: 'Skills',
    about: 'The skills installed on this computer.',
    params: {},
    period: false,
    columns: [col('skill', 'Skill', 'string'), col('description', 'Description', 'string'), col('source', 'Source', 'string'), col('active', 'Active', 'string'), col('collision', 'Name used twice', 'string')],
    routes: () => [{ key: 'skills', method: 'GET', path: '/kybernos-skills/skills' }],
    build: (parts) => {
      const rows = arr(obj(parts.skills).skills).filter((s) => isObj(s) && typeof s.name === 'string' && s.name !== '').map((s) => ({
        skill: s.name, description: cut(s.description, 140), source: str(s.source) || str(s.root), active: s.active === false ? 'no' : 'yes', collision: s.collision === true ? 'yes' : 'no',
      }))
      return table(PROVIDERS['skills.list'].columns, rows)
    },
  },
  'sessions.runs': {
    label: 'Sessions with runs',
    about: 'Sessions that carry team runs, newest first (up to 200).',
    params: { limit: 'number 1..200, default 50' },
    period: false,
    columns: [col('title', 'Session', 'string'), col('session', 'Session id', 'string'), col('workspace', 'Folder', 'string'), col('runs', 'Runs', 'number'), col('team_runs', 'Team tasks', 'number'), col('at', 'Last activity', 'time'), col('day', 'Day', 'date')],
    routes: (p) => [{ key: 'index', method: 'GET', path: '/kybernos/runs-index?limit=' + clampInt(p.limit, 1, 200, 50) }],
    build: (parts) => {
      const rows = arr(obj(parts.index).entries).filter((e) => isObj(e) && typeof e.sessionId === 'string').map((e) => {
        const at = toMs(e.lastActivityAt)
        const folder = str(e.workspace)
        return { title: cut(e.title, 80) || e.sessionId.slice(0, 8), session: e.sessionId, workspace: folder.split('/').filter(Boolean).slice(-1)[0] || '', runs: num(e.runCount), team_runs: num(e.teamCount), at: at === null ? '' : new Date(at).toISOString(), day: at === null ? '' : dayKey(at) }
      })
      return table(PROVIDERS['sessions.runs'].columns, rows)
    },
  },
  'deliverables.list': {
    label: 'Deliverables',
    about: 'The files your Agent Teams produced (the Deliverables page).',
    params: { limit: 'number 1..60, default 20' },
    period: false,
    columns: [col('name', 'Name', 'string'), col('kind', 'Kind', 'string'), col('workspace', 'Project', 'string'), col('size', 'Size (KB)', 'number'), col('at', 'Modified', 'time'), col('day', 'Day', 'date')],
    routes: () => [{ key: 'load', method: 'GET', path: '/kybernos/load' }],
    build: (parts, p) => {
      const limit = clampInt(p.limit, 1, 60, 20)
      const kindOf = (n) => { const m = /\.([a-z0-9]{1,8})$/i.exec(n); const e = m === null ? '' : m[1].toLowerCase(); return /^miniapp$/.test(e) ? 'mini app' : (e === 'md' ? 'document' : (e || 'file')) }
      const rows = arr(obj(parts.load).artifacts).filter(isObj).map((a) => {
        const name = cut(a.title || a.name || str(a.path).split('/').pop(), 80)
        const at = toMs(a.mtimeMs)
        return { name, kind: str(a.kind) !== '' ? cut(a.kind, 24) : kindOf(str(a.name || a.path)), workspace: cut(a.workspace, 40), size: Math.round(num(a.size) / 102.4) / 10, at: at === null ? '' : new Date(at).toISOString(), day: at === null ? '' : dayKey(at) }
      }).filter((r) => r.name !== '')
      rows.sort((a, b) => (a.at < b.at ? 1 : -1))
      return table(PROVIDERS['deliverables.list'].columns, rows.slice(0, limit))
    },
  },
}
export const PROVIDER_IDS = Object.keys(PROVIDERS)

/** The requests to make for a source: [{ key, method, path, body?, optional? }]. */
export const planFor = (source, now) => {
  const p = PROVIDERS[source && source.provider]
  if (p === undefined) return []
  return p.routes(obj(source.params), now)
}
/** The table for a source, from the answers keyed like the plan. Never throws: a provider that cannot read its answer returns an empty table. */
export const buildTable = (source, parts, now) => {
  const p = PROVIDERS[source && source.provider]
  if (p === undefined) return table([], [], { note: 'Unknown source.' })
  try { return p.build(obj(parts), obj(source.params), now) } catch (e) { return table(p.columns, [], { note: 'This source answered something unexpected.' }) }
}
/** Whether a provider's period parameter is honoured: the page says so instead of pretending. */
export const supportsPeriod = (id) => (PROVIDERS[id] ? PROVIDERS[id].period === true : false)

// ── 3. the widget catalogue ──────────────────────────────────────────────────

export const CHART_KINDS = ['columns', 'stacked', 'bars', 'line', 'area', 'donut']
export const AGGS = ['sum', 'count', 'distinct', 'avg', 'min', 'max', 'last']
export const TINTS = ['', 'amber', 'green', 'blue', 'pink']
export const NODE_STATES = ['ok', 'warn', 'fail', 'run', 'idle']
export const FORMATS = ['number', 'compact', 'percent']

export const WIDGETS = {
  card: { w: 3, h: 2, bound: true, about: 'One number with a short line under it and an optional sparkline. metric:{agg,field,where} (agg: sum|count|distinct|avg|min|max|last), format (number|compact|percent), unit, alertAbove (number turns the card amber), sub:{template:"{v} failed", metric:{...}, state, warnAbove}, spark:{x,y,agg}.' },
  chart: { w: 6, h: 4, bound: true, about: 'kind: columns | stacked | bars (ranked, horizontal) | line | area | donut. x = field to group by, y = numeric field (omit to count rows), series = field to split by, agg, where, sort, limit.' },
  calendar: { w: 8, h: 5, bound: true, about: 'A week (Monday to Sunday) of events. at = time field, label = text field, state = state field. Best with automations.timeline.' },
  list: { w: 4, h: 5, bound: true, about: 'Rows with a state dot. label (main text), sub, when = fields; state = state field; sort ("-at"), limit; failedChip adds an All/Failed filter.' },
  kanban: { w: 8, h: 5, bound: false, about: 'Bound: groupBy = field, columns = [{value,label}], label, sub (fields). Manual (manual:true): cols = [{t, c:[[title, sub]]}] that the user drags.' },
  note: { w: 4, h: 3, bound: false, about: 'Free text, or a checklist (check:[[text, done]]). tint: amber | green | blue | pink. Written in the dashboard file itself.' },
  carousel: { w: 12, h: 3, bound: true, about: 'Cards you scroll sideways. label, sub, kind = fields; limit.' },
  flow: { w: 12, h: 5, bound: false, about: 'Nodes and links, like a pipeline. nodes:[{id,t,k,s,sub,x,y}] s = ok | warn | fail | run | idle; edges:[[from,to,"f"?]] ("f" = on failure).' },
  sankey: { w: 8, h: 5, bound: true, about: 'Where a quantity goes, in 2 or 3 stages. stages = [field, field, field?], value = numeric field, where.' },
}
export const WIDGET_TYPES = Object.keys(WIDGETS)

const cleanWhere = (raw) => {
  const out = []
  const ops = ['=', '!=', 'in', 'not_in', '>', '>=', '<', '<=', 'contains', 'empty', 'not_empty']
  if (isObj(raw)) { for (const k of Object.keys(raw).slice(0, 6)) { const v = raw[k]; if (typeof v === 'string' || typeof v === 'number') out.push({ field: cut(k, 40), op: '=', value: v }); else if (Array.isArray(v)) out.push({ field: cut(k, 40), op: 'in', value: v.filter((x) => typeof x === 'string' || typeof x === 'number').slice(0, 12) }) } return out }
  for (const w of arr(raw).slice(0, 6)) {
    if (!isObj(w) || str(w.field) === '') continue
    const op = ops.includes(w.op) ? w.op : '='
    const value = Array.isArray(w.value) ? w.value.filter((x) => typeof x === 'string' || typeof x === 'number').slice(0, 12) : (typeof w.value === 'string' || typeof w.value === 'number' ? w.value : '')
    out.push({ field: cut(w.field, 40), op, value })
  }
  return out
}
const cleanMetric = (raw, defAgg) => {
  const m = isObj(raw) ? raw : {}
  const agg = AGGS.includes(m.agg) ? m.agg : defAgg
  const o = { agg }
  if (str(m.field) !== '') o.field = cut(m.field, 40)
  const w = cleanWhere(m.where)
  if (w.length > 0) o.where = w
  return o
}
const cleanSource = (raw, errors, at) => {
  if (!isObj(raw) || typeof raw.provider !== 'string') { errors.push(at + ': a source {provider, params?} is required'); return null }
  if (!own(PROVIDERS, raw.provider)) { errors.push(at + ': unknown source "' + cut(raw.provider, 40) + '" (known: ' + PROVIDER_IDS.join(', ') + ')'); return null }
  const params = {}
  const declared = PROVIDERS[raw.provider].params
  for (const k of Object.keys(obj(raw.params)).slice(0, 8)) {
    if (!own(declared, k)) { errors.push(at + ': "' + raw.provider + '" has no parameter "' + cut(k, 30) + '"'); continue }
    const v = raw.params[k]
    if (typeof v === 'number' && Number.isFinite(v)) params[k] = v
    else if (typeof v === 'string') params[k] = cut(v, 60)
  }
  return { provider: raw.provider, params }
}

function cleanWidget (raw, i, errors, usedIds) {
  const at = 'widgets[' + i + ']'
  if (!isObj(raw)) { errors.push(at + ': not an object, dropped'); return null }
  const type = str(raw.type)
  if (!own(WIDGETS, type)) { errors.push(at + ': unknown type "' + cut(type, 30) + '", dropped (known: ' + WIDGET_TYPES.join(', ') + ')'); return null }
  const spec = WIDGETS[type]
  let id = slug(raw.id, type + '-' + (i + 1))
  for (let n = 2; usedIds.has(id); n++) id = slug(raw.id, type) + '-' + n
  usedIds.add(id)
  const w = { id, type, title: cut(raw.title, LIMITS.title), w: clampInt(raw.w, 1, 12, spec.w), h: clampInt(raw.h, 1, 8, spec.h) }
  const manualKanban = type === 'kanban' && raw.manual === true
  const needsSource = spec.bound === true || (type === 'kanban' && !manualKanban)
  if (needsSource) {
    const s = cleanSource(raw.source, errors, at)
    if (s === null) return null
    w.source = s
  }
  const field = (key, d) => { const v = cut(raw[key], 40); return v !== '' ? v : d }
  switch (type) {
    case 'card': {
      w.metric = cleanMetric(raw.metric, 'count')
      w.format = FORMATS.includes(raw.format) ? raw.format : 'number'
      if (str(raw.unit) !== '') w.unit = cut(raw.unit, 16)
      if (typeof raw.alertAbove === 'number' && Number.isFinite(raw.alertAbove)) w.alertAbove = raw.alertAbove
      if (isObj(raw.sub)) {
        w.sub = { template: cut(raw.sub.template, 80) || '{v}' }
        if (isObj(raw.sub.metric)) w.sub.metric = cleanMetric(raw.sub.metric, 'count')
        if (['ok', 'warn', 'fail', 'idle'].includes(raw.sub.state)) w.sub.state = raw.sub.state
        if (typeof raw.sub.warnAbove === 'number' && Number.isFinite(raw.sub.warnAbove)) w.sub.warnAbove = raw.sub.warnAbove
      }
      if (isObj(raw.spark) && str(raw.spark.x) !== '') {
        w.spark = { x: cut(raw.spark.x, 40), agg: AGGS.includes(raw.spark.agg) ? raw.spark.agg : (str(raw.spark.y) !== '' ? 'sum' : 'count') }
        if (str(raw.spark.y) !== '') w.spark.y = cut(raw.spark.y, 40)
      }
      break
    }
    case 'chart': {
      w.kind = CHART_KINDS.includes(raw.kind) ? raw.kind : 'columns'
      w.x = field('x', ''); if (w.x === '') { errors.push(at + ': a chart needs x (the field to group by)'); return null }
      if (str(raw.y) !== '') w.y = cut(raw.y, 40)
      if (str(raw.series) !== '') w.series = cut(raw.series, 40)
      w.agg = AGGS.includes(raw.agg) ? raw.agg : (w.y === undefined ? 'count' : 'sum')
      const wh = cleanWhere(raw.where); if (wh.length > 0) w.where = wh
      if (['x', 'y', '-y'].includes(raw.sort)) w.sort = raw.sort
      w.limit = clampInt(raw.limit, 1, 40, w.kind === 'donut' ? 6 : 8)
      if (str(raw.unit) !== '') w.unit = cut(raw.unit, 16)
      break
    }
    case 'calendar': {
      w.at = field('at', 'at'); w.label = field('label', 'automation'); w.state = field('state', 'state')
      break
    }
    case 'list': {
      w.label = field('label', ''); w.sub = field('sub', ''); w.when = field('when', ''); w.state = field('state', '')
      if (w.label === '') { errors.push(at + ': a list needs label (the field shown on each row)'); return null }
      const wh = cleanWhere(raw.where); if (wh.length > 0) w.where = wh
      if (str(raw.sort) !== '') w.sort = cut(raw.sort, 41)
      w.limit = clampInt(raw.limit, 1, 60, 12)
      w.failedChip = raw.failedChip === true
      break
    }
    case 'kanban': {
      if (manualKanban) {
        w.manual = true
        w.cols = arr(raw.cols).slice(0, LIMITS.cols).filter(isObj).map((c) => ({ t: cut(c.t, 40), c: arr(c.c).slice(0, LIMITS.cards).filter((k) => Array.isArray(k) || typeof k === 'string').map((k) => (Array.isArray(k) ? [cut(k[0], 80), cut(k[1], 80)] : [cut(k, 80), '']))}))
        if (w.cols.length === 0) w.cols = [{ t: 'To do', c: [] }, { t: 'Doing', c: [] }, { t: 'Done', c: [] }]
      } else {
        w.groupBy = field('groupBy', 'state'); w.label = field('label', ''); w.sub = field('sub', '')
        if (w.label === '') { errors.push(at + ': a bound kanban needs label (the field shown on each card)'); return null }
        w.columns = arr(raw.columns).slice(0, LIMITS.cols).filter(isObj).map((c) => ({ value: cut(c.value, 40), label: cut(c.label, 40) || cut(c.value, 40) }))
        if (w.columns.length === 0) { errors.push(at + ': a bound kanban needs columns:[{value,label}]'); return null }
        w.limit = clampInt(raw.limit, 1, 20, 8)
        const wh = cleanWhere(raw.where); if (wh.length > 0) w.where = wh
      }
      break
    }
    case 'note': {
      w.tint = TINTS.includes(raw.tint) ? raw.tint : ''
      if (Array.isArray(raw.check)) w.check = raw.check.slice(0, LIMITS.items).filter((c) => Array.isArray(c) || typeof c === 'string').map((c) => (Array.isArray(c) ? [cut(c[0], 160), c[1] ? 1 : 0] : [cut(c, 160), 0]))
      else w.text = String(raw.text === undefined || raw.text === null ? '' : raw.text).slice(0, LIMITS.text)
      break
    }
    case 'carousel': {
      w.label = field('label', ''); w.sub = field('sub', ''); w.kindField = field('kind', '')
      if (w.label === '') { errors.push(at + ': a carousel needs label (the field shown on each card)'); return null }
      w.limit = clampInt(raw.limit, 1, 30, 12)
      break
    }
    case 'flow': {
      const used = new Set()
      w.nodes = arr(raw.nodes).slice(0, LIMITS.nodes).filter(isObj).map((n, k) => {
        let nid = slug(n.id, 'n' + (k + 1)); for (let c = 2; used.has(nid); c++) nid = slug(n.id, 'n') + '-' + c
        used.add(nid)
        return { id: nid, t: cut(n.t, 40), k: cut(n.k, 20), s: NODE_STATES.includes(n.s) ? n.s : 'idle', sub: cut(n.sub, 60), x: clampInt(n.x, 0, 780, (k % 4) * 230 + 30), y: clampInt(n.y, 0, 160, Math.floor(k / 4) * 90 + 20) }
      })
      w.edges = arr(raw.edges).slice(0, LIMITS.edges).filter((e) => Array.isArray(e) && used.has(slug(e[0], '')) && used.has(slug(e[1], ''))).map((e) => [slug(e[0], ''), slug(e[1], ''), e[2] === 'f' ? 'f' : ''])
      if (w.nodes.length === 0) { errors.push(at + ': a flow needs nodes'); return null }
      break
    }
    case 'sankey': {
      w.stages = arr(raw.stages).filter((s) => typeof s === 'string' && s !== '').map((s) => cut(s, 40)).slice(0, LIMITS.stages)
      if (w.stages.length < 2) { errors.push(at + ': a sankey needs stages: two or three fields'); return null }
      if (str(raw.value) !== '') w.value = cut(raw.value, 40)
      const wh = cleanWhere(raw.where); if (wh.length > 0) w.where = wh
      if (str(raw.unit) !== '') w.unit = cut(raw.unit, 16)
      break
    }
    default: break
  }
  return w
}

/**
 * A dashboard from anything. Returns { ok, dashboard, errors }.
 * `ok` is false only when the input is not an object at all; a dashboard with no valid widget is still a dashboard.
 */
export function validateDashboard (raw) {
  const errors = []
  if (!isObj(raw)) return { ok: false, dashboard: emptyDashboard(), errors: ['the dashboard must be an object'] }
  const used = new Set()
  const widgets = []
  arr(raw.widgets).forEach((r, i) => {
    if (widgets.length >= LIMITS.widgets) { if (i === LIMITS.widgets) errors.push('widgets: only the first ' + LIMITS.widgets + ' are kept'); return }
    const w = cleanWidget(r, i, errors, used)
    if (w !== null) widgets.push(w)
  })
  return {
    ok: true,
    errors,
    dashboard: { version: VERSION, name: cut(raw.name, LIMITS.title) || 'Dashboard', desc: cut(raw.desc, LIMITS.desc), widgets },
  }
}
export const emptyDashboard = () => ({ version: VERSION, name: 'Dashboard', desc: '', widgets: [] })

/**
 * Warnings a person (or the agent) can act on: fields that are not columns of the source, a number asked of a text
 * column, a widget too small to read. Pure; it does not touch the data.
 */
export function inspectDashboard (d) {
  const out = []
  const ws = arr(d && d.widgets)
  const colsOf = (w) => (w.source && PROVIDERS[w.source.provider] ? PROVIDERS[w.source.provider].columns : null)
  const need = (w, cols, field, label, numeric) => {
    if (field === undefined || field === '' || cols === null) return
    const c = cols.find((x) => x.id === field)
    if (c === undefined) { out.push('widget "' + w.id + '": ' + label + ' "' + field + '" is not a column of ' + w.source.provider + ' (columns: ' + cols.map((x) => x.id).join(', ') + ')'); return }
    if (numeric === true && c.type !== 'number') out.push('widget "' + w.id + '": ' + label + ' "' + field + '" is ' + c.type + ', not a number (use agg "count", or a numeric column)')
  }
  for (const w of ws) {
    const cols = colsOf(w)
    const numericAgg = (m) => m && ['sum', 'avg', 'min', 'max'].includes(m.agg)
    if (w.type === 'card') {
      if (numericAgg(w.metric)) need(w, cols, w.metric.field, 'metric.field', true)
      else if (w.metric && w.metric.field) need(w, cols, w.metric.field, 'metric.field', false)
      if (w.spark) { need(w, cols, w.spark.x, 'spark.x', false); need(w, cols, w.spark.y, 'spark.y', true) }
      if (w.w < 2) out.push('widget "' + w.id + '": a card narrower than 2 columns is hard to read')
    }
    if (w.type === 'chart') {
      need(w, cols, w.x, 'x', false)
      if (w.y !== undefined) need(w, cols, w.y, 'y', w.agg !== 'count' && w.agg !== 'last')
      need(w, cols, w.series, 'series', false)
      if (w.w < 4) out.push('widget "' + w.id + '": a chart narrower than 4 columns is hard to read')
      if (w.kind === 'donut' && w.series !== undefined) out.push('widget "' + w.id + '": a donut ignores series; use kind "stacked" to split by it')
      if (w.source && !supportsPeriod(w.source.provider) && w.source.params.days !== undefined) out.push('widget "' + w.id + '": ' + w.source.provider + ' has no period filter, it shows the current state')
    }
    if (w.type === 'calendar') { need(w, cols, w.at, 'at', false); need(w, cols, w.label, 'label', false); need(w, cols, w.state, 'state', false) }
    if (w.type === 'list') { need(w, cols, w.label, 'label', false); need(w, cols, w.sub, 'sub', false); need(w, cols, w.when, 'when', false); need(w, cols, w.state, 'state', false) }
    if (w.type === 'kanban' && w.manual !== true) { need(w, cols, w.groupBy, 'groupBy', false); need(w, cols, w.label, 'label', false); need(w, cols, w.sub, 'sub', false) }
    if (w.type === 'carousel') { need(w, cols, w.label, 'label', false); need(w, cols, w.sub, 'sub', false); need(w, cols, w.kindField, 'kind', false) }
    if (w.type === 'sankey') { for (const s of w.stages) need(w, cols, s, 'stage', false); need(w, cols, w.value, 'value', true); if (w.value === undefined) out.push('widget "' + w.id + '": a sankey without value counts rows') }
    if (w.type === 'note' && !w.text && !(w.check && w.check.length)) out.push('widget "' + w.id + '": the note is empty')
    if (w.type === 'flow' && w.edges.length === 0 && w.nodes.length > 1) out.push('widget "' + w.id + '": the flow has several nodes and no edge')
  }
  if (ws.length === 0) out.push('the dashboard has no widget yet')
  const seen = new Map()
  for (const w of ws) { const k = w.type + '|' + w.title; if (w.title !== '' && seen.has(k)) out.push('widgets "' + seen.get(k) + '" and "' + w.id + '" have the same type and title'); else seen.set(k, w.id) }
  return out
}

/** The sources a dashboard reads: [{ provider, label, widgets }]. */
export function sourcesOf (d) {
  const by = new Map()
  for (const w of arr(d && d.widgets)) {
    if (!w.source) continue
    const id = w.source.provider
    if (!by.has(id)) by.set(id, { provider: id, label: PROVIDERS[id] ? PROVIDERS[id].label : id, widgets: [] })
    by.get(id).widgets.push(w.id)
  }
  return Array.from(by.values())
}

/** The text of the agent tool's description for providers and widgets, generated from the same tables the validator uses. */
export function describeCatalogue () {
  const prov = PROVIDER_IDS.map((id) => {
    const p = PROVIDERS[id]
    return '- ' + id + ': ' + p.about + (Object.keys(p.params).length ? ' Params: ' + Object.keys(p.params).map((k) => k + ' (' + p.params[k] + ')').join('; ') + '.' : '')
      + ' Columns: ' + p.columns.map((c) => c.id + ':' + c.type).join(', ') + '.' + (p.period ? '' : ' No period filter: it shows the current state.')
  }).join('\n')
  const wid = WIDGET_TYPES.map((t) => '- ' + t + ' (default ' + WIDGETS[t].w + 'x' + WIDGETS[t].h + '): ' + WIDGETS[t].about).join('\n')
  return { providers: prov, widgets: wid }
}

// ── 5. query ─────────────────────────────────────────────────────────────────

const cellNum = (v) => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? n : 0 }
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

export function applyWhere (rows, where) {
  const conds = arr(where)
  if (conds.length === 0) return rows
  return rows.filter((r) => conds.every((c) => {
    const v = r[c.field]
    switch (c.op) {
      case '=': return same(v, c.value)
      case '!=': return !same(v, c.value)
      case 'in': return arr(c.value).some((x) => same(v, x))
      case 'not_in': return !arr(c.value).some((x) => same(v, x))
      case '>': return cellNum(v) > cellNum(c.value)
      case '>=': return cellNum(v) >= cellNum(c.value)
      case '<': return cellNum(v) < cellNum(c.value)
      case '<=': return cellNum(v) <= cellNum(c.value)
      case 'contains': return String(v === undefined || v === null ? '' : v).toLowerCase().includes(String(c.value).toLowerCase())
      case 'empty': return v === undefined || v === null || v === ''
      case 'not_empty': return !(v === undefined || v === null || v === '')
      default: return true
    }
  }))
}

/** One number from rows: agg of a field (count needs none). `last` is the value of the last row. */
export function aggregate (rows, agg, field) {
  if (agg === 'distinct' && field !== undefined && field !== '') return new Set(rows.map((r) => String(r[field]))).size
  if (agg === 'count' || field === undefined || field === '') return rows.length
  const vals = rows.map((r) => cellNum(r[field]))
  if (vals.length === 0) return 0
  switch (agg) {
    case 'avg': return vals.reduce((a, b) => a + b, 0) / vals.length
    case 'min': return Math.min.apply(null, vals)
    case 'max': return Math.max.apply(null, vals)
    case 'last': return vals[vals.length - 1]
    default: return vals.reduce((a, b) => a + b, 0)
  }
}

// ── 6. shapers ───────────────────────────────────────────────────────────────

/** 1234 -> "1,234"; 1_250_000 -> "1.3M" in compact. Deterministic: no locale. */
export function formatNumber (v, format) {
  const n = Number.isFinite(v) ? v : 0
  if (format === 'percent') return (Math.round(n * 10) / 10) + '%'
  const a = Math.abs(n)
  if (format === 'compact' || a >= 1e6) {
    if (a >= 1e9) return (Math.round(n / 1e8) / 10) + 'B'
    if (a >= 1e6) return (Math.round(n / 1e5) / 10) + 'M'
    if (a >= 1e4) return (Math.round(n / 100) / 10) + 'k'
  }
  const r = a >= 100 ? Math.round(n) : Math.round(n * 10) / 10
  const [i, f] = String(r).split('.')
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : '')
}

const colType = (t, id) => { const c = arr(t.columns).find((x) => x.id === id); return c === undefined ? 'string' : c.type }
/** The colour a run state keeps in every chart: done is green, failed red, queued amber; the others are quiet greys. */
export const stateTone = (v) => ({ done: 'ok', failed: 'err', queued: 'warn', upcoming: 'idle', paused: 'mute', none: 'mute' })[String(v)]

export function cardData (t, w) {
  const rows = applyWhere(t.rows, w.metric.where)
  const v = aggregate(rows, w.metric.agg, w.metric.field)
  const out = { value: v, text: formatNumber(v, w.format) + (w.unit ? ' ' + w.unit : ''), sub: '', st: 'ok', spark: null, empty: t.rows.length === 0 }
  if (w.sub) {
    const m = w.sub.metric ? w.sub.metric : w.metric
    const sv = aggregate(applyWhere(t.rows, m.where), m.agg, m.field)
    out.sub = String(w.sub.template || '{v}').replace(/\{v\}/g, formatNumber(sv, 'number')).replace(/\{total\}/g, formatNumber(v, 'number'))
    out.st = w.sub.state !== undefined ? w.sub.state : (typeof w.sub.warnAbove === 'number' && sv > w.sub.warnAbove ? 'warn' : 'ok')
    out.subValue = sv
  }
  if (typeof w.alertAbove === 'number' && v > w.alertAbove) out.st = 'warn'
  if (w.spark) {
    const dom = t.meta && t.meta.xDomain && t.meta.xDomain.field === w.spark.x ? t.meta.xDomain.values : null
    const by = new Map()
    for (const r of t.rows) { const k = String(r[w.spark.x]); if (!by.has(k)) by.set(k, []); by.get(k).push(r) }
    const keys = dom !== null ? dom : Array.from(by.keys()).sort()
    out.spark = keys.map((k) => aggregate(by.get(k) || [], w.spark.agg, w.spark.y))
  }
  return out
}

/**
 * What a chart draws: { kind, labels:[{key,label}], series:[{key,name,values}], totals, unit, empty }.
 * Time axes are filled from the source's own domain, so a day with nothing is a zero, not a gap.
 */
export function chartData (t, w, opts) {
  const o = opts || {}
  const rows = applyWhere(t.rows, w.where)
  const yField = w.y
  const val = (rs) => aggregate(rs, yField === undefined ? 'count' : w.agg, yField)
  const empty = rows.length === 0
  const unit = w.unit || ''
  if (w.kind === 'bars' || w.kind === 'donut') {
    const by = new Map()
    for (const r of rows) { const k = String(r[w.x]); if (!by.has(k)) by.set(k, []); by.get(k).push(r) }
    let items = Array.from(by.keys()).map((k) => ({ key: k, label: k, v: val(by.get(k)) }))
    items.sort((a, b) => (w.sort === 'x' ? (a.label < b.label ? -1 : 1) : b.v - a.v))
    const cap = Math.max(1, Math.min(w.limit, o.maxItems || 40))
    if (items.length > cap) {
      const rest = items.slice(cap - 1)
      items = items.slice(0, cap - 1).concat([{ key: '__other', label: 'Other (' + rest.length + ')', v: rest.reduce((a, b) => a + b.v, 0), other: true }])
    }
    const stateX = colType(t, w.x) === 'state'
    return { kind: w.kind, labels: items.map((i) => ({ key: i.key, label: i.label, other: i.other === true, tone: stateX && !i.other ? stateTone(i.key) : undefined })), series: [{ key: 'v', name: w.title || w.x, values: items.map((i) => i.v) }], totals: items.map((i) => i.v), unit, empty }
  }
  // time or category on x, optional series
  const dom = t.meta && t.meta.xDomain && t.meta.xDomain.field === w.x ? t.meta.xDomain.values.slice() : null
  const keysSet = new Set(dom || [])
  for (const r of rows) keysSet.add(String(r[w.x]))
  let keys = Array.from(keysSet)
  if (dom === null) {
    const type = colType(t, w.x)
    if (w.sort === '-y' || w.sort === 'y') { /* decided below with totals */ } else keys.sort((a, b) => (type === 'number' ? Number(a) - Number(b) : (a < b ? -1 : a > b ? 1 : 0)))
  }
  const seriesKeys = []
  if (w.series) {
    const tot = new Map()
    for (const r of rows) { const k = String(r[w.series]); tot.set(k, (tot.get(k) || 0) + (yField === undefined ? 1 : cellNum(r[yField]))) }
    const sorted = Array.from(tot.keys()).sort((a, b) => tot.get(b) - tot.get(a) || (a < b ? -1 : 1))
    const max = 6
    for (const k of sorted.slice(0, sorted.length > max ? max - 1 : max)) seriesKeys.push(k)
    if (sorted.length > max) seriesKeys.push('__other')
  } else seriesKeys.push('__all')
  const cell = new Map()
  for (const r of rows) {
    const sk = w.series ? (seriesKeys.includes(String(r[w.series])) ? String(r[w.series]) : '__other') : '__all'
    const key = String(r[w.x]) + '\u0000' + sk
    if (!cell.has(key)) cell.set(key, [])
    cell.get(key).push(r)
  }
  const stateSeries = w.series !== undefined && colType(t, w.series) === 'state'
  const series = seriesKeys.map((sk) => ({ key: sk, name: sk === '__all' ? (w.title || w.y || 'Count') : (sk === '__other' ? 'Other' : sk), tone: stateSeries && sk !== '__other' ? stateTone(sk) : undefined, values: keys.map((k) => val(cell.get(k + '\u0000' + sk) || [])) }))
  const totals = keys.map((_, i) => series.reduce((a, s) => a + s.values[i], 0))
  if (dom === null && (w.sort === '-y' || w.sort === 'y')) {
    const idx = keys.map((_, i) => i).sort((a, b) => (w.sort === 'y' ? totals[a] - totals[b] : totals[b] - totals[a]))
    keys = idx.map((i) => keys[i])
    for (const s of series) s.values = idx.map((i) => s.values[i])
    const t2 = idx.map((i) => totals[i])
    return { kind: w.kind, labels: keys.map((k) => ({ key: k, label: k })), series, totals: t2, unit, empty }
  }
  return { kind: w.kind, labels: keys.map((k) => ({ key: k, label: k })), series, totals, unit, empty }
}

export function listData (t, w, chip) {
  const whenType = w.when ? colType(t, w.when) : 'string'
  let rows = applyWhere(t.rows, w.where)
  if (w.failedChip === true && chip === 'failed') rows = rows.filter((r) => r[w.state] === 'failed')
  if (w.sort) {
    const desc = w.sort.startsWith('-'); const f = desc ? w.sort.slice(1) : w.sort
    rows = rows.slice().sort((a, b) => { const x = a[f]; const y = b[f]; const c = typeof x === 'number' && typeof y === 'number' ? x - y : (String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0); return desc ? -c : c })
  }
  const subType = w.sub ? colType(t, w.sub) : 'string'
  return rows.slice(0, w.limit || 12).map((r) => ({ title: String(r[w.label] === undefined ? '' : r[w.label]), sub: w.sub ? String(r[w.sub] === undefined ? '' : r[w.sub]) : '', subType, when: w.when ? String(r[w.when] === undefined ? '' : r[w.when]) : '', whenType, state: w.state ? String(r[w.state] === undefined ? '' : r[w.state]) : '' }))
}

export function kanbanData (t, w) {
  if (w.manual === true) return w.cols.map((c) => ({ title: c.t, cards: c.c.map((k) => ({ title: k[0], sub: k[1], subType: 'string' })), total: c.c.length }))
  const rows = applyWhere(t.rows, w.where)
  return w.columns.map((c) => {
    const mine = rows.filter((r) => same(r[w.groupBy], c.value))
    const subType = w.sub ? colType(t, w.sub) : 'string'
    return { title: c.label, value: c.value, total: mine.length, cards: mine.slice(0, w.limit || 8).map((r) => ({ title: String(r[w.label] === undefined ? '' : r[w.label]), sub: w.sub ? String(r[w.sub] === undefined ? '' : r[w.sub]) : '', subType })) }
  })
}

export function carouselData (t, w) {
  return t.rows.slice(0, w.limit || 12).map((r) => ({ title: String(r[w.label] === undefined ? '' : r[w.label]), sub: w.sub ? String(r[w.sub] === undefined ? '' : r[w.sub]) : '', kind: w.kindField ? String(r[w.kindField] === undefined ? '' : r[w.kindField]) : '' }))
}

/** The week of a calendar: seven days Monday..Sunday, each with its events in time order. */
export function calendarData (t, w, nowMs) {
  const dom = t.meta && t.meta.xDomain && t.meta.xDomain.field === 'day' && t.meta.xDomain.values.length === 7 ? t.meta.xDomain.values : null
  let days
  if (dom !== null) days = dom.slice()
  else {
    const d = new Date(nowMs); const dow = (d.getDay() + 6) % 7
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow).getTime()
    days = [0, 1, 2, 3, 4, 5, 6].map((i) => dayKey(monday + i * DAY + 3600000))
  }
  const today = dayKey(nowMs)
  return days.map((key) => {
    const evs = t.rows.filter((r) => dayKey(toMs(r[w.at]) === null ? 0 : toMs(r[w.at])) === key)
      .sort((a, b) => (toMs(a[w.at]) || 0) - (toMs(b[w.at]) || 0))
      .map((r) => { const ms = toMs(r[w.at]); const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return { time: p(d.getHours()) + ':' + p(d.getMinutes()), title: String(r[w.label] === undefined ? '' : r[w.label]), state: String(r[w.state] === undefined ? '' : r[w.state]), detail: str(r.error) } })
    const [y, m, dd] = key.split('-').map(Number)
    return { key, dow: new Date(y, m - 1, dd).getDay(), n: dd, today: key === today, events: evs }
  })
}

/** Stages of values -> nodes by column and links [fromCol, fromIdx, toCol, toIdx, value], the shape chart-core's sankey lays out. */
export function sankeyData (t, w) {
  const rows = applyWhere(t.rows, w.where)
  const stages = w.stages
  const idx = stages.map(() => new Map())
  const cols = stages.map(() => [])
  const nodeOf = (c, name) => { if (!idx[c].has(name)) { idx[c].set(name, cols[c].length); cols[c].push({ name, v: 0 }) } return idx[c].get(name) }
  const links = new Map()
  for (const r of rows) {
    const v = w.value === undefined ? 1 : cellNum(r[w.value])
    if (v <= 0) continue
    for (let c = 0; c < stages.length - 1; c++) {
      const a = nodeOf(c, String(r[stages[c]])); const b = nodeOf(c + 1, String(r[stages[c + 1]]))
      const key = c + ':' + a + ':' + b
      links.set(key, (links.get(key) || 0) + v)
    }
  }
  const out = []
  for (const [k, v] of links) { const [c, a, b] = k.split(':').map(Number); out.push([c, a, c + 1, b, v]) }
  // totals per node (outgoing for all but the last column, incoming for the last)
  for (const l of out) { cols[l[0]][l[1]].v += l[4] }
  for (const l of out) { if (l[2] === stages.length - 1) cols[l[2]][l[3]].v += l[4] }
  // keep the picture readable: the biggest 8 nodes per column, ordered by size
  const order = cols.map((c) => c.map((n, i) => i).sort((a, b) => c[b].v - c[a].v).slice(0, 8))
  const remap = order.map((o) => { const m = new Map(); o.forEach((old, i) => m.set(old, i)); return m })
  const nodes = order.map((o, ci) => o.map((old) => cols[ci][old]))
  const kept = out.filter((l) => remap[l[0]].has(l[1]) && remap[l[2]].has(l[3])).map((l) => [l[0], remap[l[0]].get(l[1]), l[2], remap[l[2]].get(l[3]), l[4]])
  return { cols: nodes, links: kept, total: nodes[0].reduce((a, n) => a + n.v, 0), empty: kept.length === 0 }
}

