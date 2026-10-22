// kybernos-dashboards, host logic: the dashboards on disk, their revisions, and the agent's tool. No `ctx`, no DSH import:
// every effect is injected, so the whole thing runs in a test against a temp folder.
//
// A dashboard is a file in `<dsh home>/kybernos/dashboards/files/<id>.miniapp.json`, the shared creation format, so the
// Creations page, the chat card and the popup can open a copy of it too:
//
//   { "kind": "dashboard", "renderer": "dashboard", "title": "...",
//     "meta": { "version": 1, "rev": 7, "history": [ { "r": 7, "by": "agent", "at": "...", "what": "..." } ] },
//     "data": [ <dashboard> ] }
//
// Dashboards are global (not tied to a project), so they live in the plugin's own store. Which one opens first, and what is
// hidden or archived, is in `index.json` next to them. The agent never writes a path: it names a dashboard by its id.
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { KIND, LIMITS, VERSION, describeCatalogue, inspectDashboard, shapeOf, slug, sourcesOf, validateDashboard } from './model.mjs'
import { PRESETS } from './presets.mjs'

export const EXT = '.miniapp.json'
export const TOOL = 'kybernos_dashboard'
export const KEEP = { revisions: 20, history: 30, files: 200 }

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const hashOf = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 16)
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The file a dashboard lives in, around a validated dashboard. */
export function makeDoc (dashboard, meta) {
  return { kind: KIND, renderer: KIND, title: dashboard.name, meta, data: [dashboard] }
}
/** The dashboard inside a parsed file (accepts the `payload` wrapper the shared contract allows). */
export function dashboardOfDoc (doc) {
  if (!isObj(doc) || doc.kind !== KIND) return null
  const first = Array.isArray(doc.data) ? doc.data[0] : null
  if (!isObj(first)) return null
  return isObj(first.payload) ? first.payload : first
}

/**
 * Operations on a dashboard that was already validated: the agent changes one widget without rewriting the whole file.
 *   { op: 'add', widget, after? }   { op: 'update', id, set }   { op: 'remove', id }   { op: 'move', id, after? | to? }
 *   { op: 'meta', name?, desc? }
 * Returns { dashboard, errors }; the result is a raw dashboard that still goes through validateDashboard.
 */
export function applyOps (current, ops) {
  const errors = []
  const d = { name: current.name, desc: current.desc, widgets: current.widgets.map((w) => JSON.parse(JSON.stringify(w))) }
  const find = (id) => d.widgets.findIndex((w) => w.id === id)
  ops.forEach((op, k) => {
    const at = 'ops[' + k + ']'
    if (!isObj(op)) { errors.push(at + ': not an object'); return }
    if (op.op === 'meta') {
      if (typeof op.name === 'string' && op.name.trim() !== '') d.name = op.name
      if (typeof op.desc === 'string') d.desc = op.desc
    } else if (op.op === 'add') {
      if (!isObj(op.widget)) { errors.push(at + ': add needs a widget'); return }
      const w = JSON.parse(JSON.stringify(op.widget))
      const pos = typeof op.after === 'string' ? find(op.after) : -1
      if (pos >= 0) d.widgets.splice(pos + 1, 0, w); else d.widgets.push(w)
    } else if (op.op === 'update') {
      const i = find(String(op.id))
      if (i < 0) { errors.push(at + ': no widget "' + String(op.id) + '"'); return }
      if (!isObj(op.set)) { errors.push(at + ': update needs set'); return }
      const next = Object.assign({}, d.widgets[i])
      for (const key of Object.keys(op.set)) { if (key === 'id') continue; if (op.set[key] === null) delete next[key]; else next[key] = op.set[key] }
      d.widgets[i] = next
    } else if (op.op === 'remove') {
      const i = find(String(op.id))
      if (i < 0) { errors.push(at + ': no widget "' + String(op.id) + '"'); return }
      d.widgets.splice(i, 1)
    } else if (op.op === 'move') {
      const i = find(String(op.id))
      if (i < 0) { errors.push(at + ': no widget "' + String(op.id) + '"'); return }
      const [w] = d.widgets.splice(i, 1)
      const after = typeof op.after === 'string' ? find(op.after) : -1
      if (after >= 0) d.widgets.splice(after + 1, 0, w)
      else if (typeof op.to === 'number') d.widgets.splice(Math.max(0, Math.min(d.widgets.length, Math.round(op.to))), 0, w)
      else d.widgets.unshift(w)
    } else errors.push(at + ': unknown op "' + String(op.op).slice(0, 20) + '" (known: add, update, remove, move, meta)')
  })
  return { dashboard: d, errors }
}

export function createHost ({ fs, home, now = () => Date.now(), log = () => {} }) {
  const root = join(home, 'kybernos', 'dashboards')
  const filesDir = join(root, 'files')
  const historyDir = (id) => join(root, 'history', hashOf(id))
  const indexFile = join(root, 'index.json')
  const fileOf = (id) => join(filesDir, id + EXT)

  async function exists (p) { try { await fs.stat(p); return true } catch { return false } }
  async function writeAtomic (path, text) {
    await fs.mkdir(join(path, '..'), { recursive: true })
    const tmp = `${path}.${process.pid}.${now()}.tmp`
    try { await fs.writeFile(tmp, text, 'utf8'); await fs.rename(tmp, path) } catch (e) { try { await fs.rm(tmp, { force: true }) } catch { /* nothing to clean */ } throw e }
  }

  // ── the index: default, hidden, archived ───────────────────────────────────
  async function readIndex () {
    try {
      const j = JSON.parse(await fs.readFile(indexFile, 'utf8'))
      const flags = {}
      if (isObj(j.flags)) for (const id of Object.keys(j.flags)) if (ID_RE.test(id) && isObj(j.flags[id])) flags[id] = { hidden: j.flags[id].hidden === true, archived: j.flags[id].archived === true }
      return { version: 1, default: typeof j.default === 'string' && ID_RE.test(j.default) ? j.default : null, flags }
    } catch { return { version: 1, default: null, flags: {} } }
  }
  async function writeIndex (idx) { await writeAtomic(indexFile, JSON.stringify(idx, null, 2)) }

  // ── reading ────────────────────────────────────────────────────────────────
  // A refusal carries a stable `code` beside its message: the page words the reason in the person's language from the code (list() → `unreadable`).
  async function readDoc (id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false, code: 'unknown', message: 'Unknown dashboard.' }
    let text
    try {
      const st = await fs.stat(fileOf(id))
      if (st.size > LIMITS.doc) return { ok: false, code: 'too-large', message: 'The dashboard file is too large.' }
      text = await fs.readFile(fileOf(id), 'utf8')
    } catch { return { ok: false, code: 'unknown', message: 'Unknown dashboard.' } }
    let doc
    try { doc = JSON.parse(text) } catch { return { ok: false, code: 'invalid-json', message: 'The dashboard file is not valid JSON.' } }
    const raw = dashboardOfDoc(doc)
    if (raw === null) return { ok: false, code: 'not-dashboard', message: 'This file is not a dashboard (kind must be "dashboard").' }
    const v = validateDashboard(raw)
    const meta = isObj(doc.meta) ? doc.meta : {}
    return { ok: true, id, doc, dashboard: v.dashboard, errors: v.errors, rev: Number(meta.rev) || 0, history: Array.isArray(meta.history) ? meta.history : [] }
  }

  async function list () {
    let names = []
    try { names = (await fs.readdir(filesDir)).filter((n) => n.endsWith(EXT)).slice(0, KEEP.files) } catch { names = [] }
    const idx = await readIndex()
    const out = []
    // A file the host cannot read is reported, not dropped: a truncated dashboard used to vanish from the page without a word.
    const unreadable = []
    for (const n of names) {
      const id = n.slice(0, -EXT.length)
      if (!ID_RE.test(id)) continue
      const r = await readDoc(id)
      if (!r.ok) {
        // The file is listed in its folder, so « unknown » here means it could not be read (permissions, a read cut short), not that it does not exist.
        unreadable.push(r.code === 'unknown' ? { id, code: 'unreadable', message: 'The dashboard file cannot be read.' } : { id, code: r.code, message: r.message })
        continue
      }
      let mtimeMs = 0
      try { mtimeMs = (await fs.stat(fileOf(id))).mtimeMs } catch { /* keep 0 */ }
      const last = r.history.length ? r.history[r.history.length - 1] : null
      const f = idx.flags[id] || { hidden: false, archived: false }
      out.push({
        id, name: r.dashboard.name, desc: r.dashboard.desc, widgets: r.dashboard.widgets.length,
        sources: sourcesOf(r.dashboard).map((s) => s.provider), rev: r.rev, by: last ? last.by : 'user', updatedAt: mtimeMs,
        hidden: f.hidden, archived: f.archived, isDefault: idx.default === id,
        shape: r.dashboard.widgets.map((w) => shapeOf(w)),
      })
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt)
    unreadable.sort((a, b) => (a.id < b.id ? -1 : 1))
    return { dashboards: out, default: idx.default, unreadable }
  }

  // ── writing ────────────────────────────────────────────────────────────────
  async function snapshot (id, doc) {
    try {
      const dir = historyDir(id)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(join(dir, `${String(doc.meta.rev).padStart(6, '0')}.json`), JSON.stringify(doc), 'utf8')
      const files = (await fs.readdir(dir)).filter((f) => /^\d{6}\.json$/.test(f)).sort()
      for (const f of files.slice(0, Math.max(0, files.length - KEEP.revisions))) await fs.rm(join(dir, f), { force: true })
    } catch (e) { log(`history not kept: ${e && e.message}`) }
  }

  /** Write a dashboard under an id. `by` is 'agent' | 'user' | 'preset'. A refused write changes nothing. */
  async function save ({ id, raw, by, what, expectRev }) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false, message: 'Invalid dashboard id.' }
    const v = validateDashboard(raw)
    if (!v.ok) return { ok: false, message: 'The dashboard must be an object.', errors: v.errors }
    const prev = (await exists(fileOf(id))) ? await readDoc(id) : null
    const prevRev = prev !== null && prev.ok ? prev.rev : 0
    if (typeof expectRev === 'number' && prev !== null && prev.ok && expectRev !== prevRev) {
      return { ok: false, conflict: true, rev: prevRev, message: 'The dashboard changed while you were editing (revision ' + prevRev + '). Reload it first.' }
    }
    const history = prev !== null && prev.ok ? prev.history : []
    const rev = prevRev + 1
    const meta = { version: VERSION, rev, history: history.concat([{ r: rev, by: by === 'user' ? 'user' : (by === 'preset' ? 'preset' : 'agent'), at: new Date(now()).toISOString(), what: String(what || '').slice(0, 160) }]).slice(-KEEP.history) }
    const doc = makeDoc(v.dashboard, meta)
    const text = JSON.stringify(doc, null, 2)
    if (text.length > LIMITS.doc) return { ok: false, message: 'The dashboard is too large to save.' }
    await writeAtomic(fileOf(id), text)
    await snapshot(id, doc)
    return { ok: true, id, rev, dashboard: v.dashboard, errors: v.errors }
  }

  /** A fresh id from a name: the slug, then -2, -3 ... until it is free. */
  async function freshId (name) {
    const base = slug(name, 'dashboard')
    let id = base
    for (let n = 2; (await exists(fileOf(id))) && n < 1000; n++) id = (base + '-' + n).slice(0, LIMITS.name + 4)
    return id
  }
  /** A display name nobody uses yet: "Usage and tokens", then "Usage and tokens 2", 3 ... (two cards must not read the same). */
  async function uniqueName (base) {
    const taken = new Set((await list()).dashboards.map((d) => d.name.toLowerCase()))
    let out = base
    for (let n = 2; taken.has(out.toLowerCase()) && n < 1000; n++) out = base + ' ' + n
    return out
  }
  /** `idBase` names the file when the display name should not (a preset keeps its own id: "usage-tokens", not "usage-and-tokens"). */
  async function create ({ name, raw, by, what, idBase }) {
    const wanted = (name !== undefined && name !== '' ? name : (isObj(raw) && typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : 'Dashboard'))
    const shown = await uniqueName(String(wanted).trim().slice(0, LIMITS.title))
    const id = await freshId(idBase !== undefined ? idBase : shown)
    return save({ id, raw: Object.assign({}, raw, { name: shown }), by, what: what || 'Created' })
  }
  async function fromPreset (presetId, name) {
    const p = PRESETS.find((x) => x.id === presetId)
    if (p === undefined) return { ok: false, message: 'Unknown preset.' }
    const own = typeof name === 'string' && name.trim() !== ''
    return create({ name: own ? name.trim() : p.name, idBase: own ? undefined : p.id, raw: { name: p.name, desc: p.desc, widgets: JSON.parse(JSON.stringify(p.widgets)) }, by: 'preset', what: 'From the preset "' + p.name + '"' })
  }
  async function clone (id) {
    const r = await readDoc(id)
    if (!r.ok) return r
    return create({ name: r.dashboard.name + ' copy', raw: r.dashboard, by: 'user', what: 'Cloned from "' + r.dashboard.name + '"' })
  }
  /** Hide, archive, make default. Archiving the default dashboard clears the default. */
  async function setFlags (id, patch) {
    if (typeof id !== 'string' || !ID_RE.test(id) || !(await exists(fileOf(id)))) return { ok: false, message: 'Unknown dashboard.' }
    const idx = await readIndex()
    const f = idx.flags[id] || { hidden: false, archived: false }
    if (typeof patch.hidden === 'boolean') f.hidden = patch.hidden
    if (typeof patch.archived === 'boolean') f.archived = patch.archived
    idx.flags[id] = f
    if (patch.default === true) idx.default = id
    if (patch.default === false && idx.default === id) idx.default = null
    if (f.archived && idx.default === id) idx.default = null
    await writeIndex(idx)
    return { ok: true, id, hidden: f.hidden, archived: f.archived, isDefault: idx.default === id }
  }

  async function revisions (id) {
    try {
      const dir = historyDir(id)
      const files = (await fs.readdir(dir)).filter((f) => /^\d{6}\.json$/.test(f)).sort().reverse()
      const out = []
      for (const f of files) {
        try {
          const d = JSON.parse(await fs.readFile(join(dir, f), 'utf8'))
          const h = (d.meta.history || []).find((e) => e.r === d.meta.rev) || {}
          out.push({ r: d.meta.rev, by: h.by || 'agent', at: h.at || null, what: h.what || '' })
        } catch { /* a damaged snapshot is skipped */ }
      }
      return out
    } catch { return [] }
  }
  async function restore (id, rev) {
    const f = join(historyDir(id), `${String(Number(rev) | 0).padStart(6, '0')}.json`)
    let snap
    try { snap = JSON.parse(await fs.readFile(f, 'utf8')) } catch { return { ok: false, message: 'That revision is no longer available.' } }
    const raw = dashboardOfDoc(snap)
    if (raw === null) return { ok: false, message: 'That revision is damaged.' }
    return save({ id, raw, by: 'user', what: `Restored r${rev}` })
  }

  /** What the person changed since the agent last wrote this dashboard (the agent reads it back). */
  function userEditsSince (history) {
    let lastAgent = 0
    for (const e of history) if (e.by === 'agent') lastAgent = Math.max(lastAgent, e.r)
    return history.filter((e) => e.by === 'user' && e.r > lastAgent).map((e) => ({ r: e.r, at: e.at, what: e.what }))
  }

  // ── per-session state: which dashboard the pane shows ──────────────────────
  const current = new Map()
  let lastSession = null
  function setCurrent (sessionId, id, name) { current.set(sessionId, { id, name, at: now() }); lastSession = sessionId }
  function getCurrent (sessionId, strict) {
    if (typeof sessionId === 'string' && current.has(sessionId)) return current.get(sessionId)
    if (strict === true) return null
    return lastSession !== null ? current.get(lastSession) || null : null
  }

  return { root, filesDir, readDoc, list, save, create, fromPreset, clone, setFlags, readIndex, revisions, restore, userEditsSince, setCurrent, getCurrent }
}

// ── the agent's tool ───────────────────────────────────────────────────────────

const WIDGET_SHAPE = 'A dashboard is {name, desc, widgets:[...]}. A widget is {id?, type, title, w (1..12 columns), h (1..8 rows), source?:{provider, params?}, ...type fields}. '
  + 'The page is a 12-column grid; a card is 3x2, a chart 6x4 or 8x4, a calendar 8x5, a list 4x5, a carousel 12x3.'

export function toolOptions (host) {
  const c = describeCatalogue()
  return {
    name: TOOL,
    description:
      'Builds and edits the user\'s dashboards (the Dashboards page, and the "Dashboard" tab of the right sidebar, which opens by itself). '
      + 'A dashboard shows the user\'s own data: usage, automations, Agent Teams, skills, sessions, deliverables. It is data, never code. '
      + 'Call with `catalogue: true` to see the sources and widgets; with nothing to list the dashboards; with `id` alone to READ one back '
      + '(with the warnings found in it and what the user changed since your last write). '
      + 'Write a new one with `dashboard` (and no id), replace one with `id` + `dashboard`, change one widget with `id` + `ops`, or start from a preset with `preset`. '
      + 'Choose the widget that fits the data: a number -> card; a series over time -> chart columns/stacked/line/area; a ranking or a share -> chart bars/donut; dates -> calendar; '
      + 'rows with a state -> list; states to scan -> kanban; a few files or items to browse -> carousel; flow of steps -> flow; where a quantity goes -> sankey. '
      + 'Name fields exactly as the source\'s columns: the result lists every field that is not a column. Never invent a source: only the ones below exist.\n'
      + WIDGET_SHAPE + '\nSources (provider ids):\n' + c.providers + '\nWidget types:\n' + c.widgets,
    parameters: {
      id: { type: 'string', description: 'Dashboard id (a short lower-case word). Omit to create a new one from `dashboard` or `preset`.' },
      dashboard: { type: 'object', additionalProperties: true, description: 'The whole dashboard to write: {name, desc, widgets:[...]}.' },
      ops: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Edits: {op:"add",widget,after?} | {op:"update",id,set:{...}} (null removes a key) | {op:"remove",id} | {op:"move",id,after?|to?} | {op:"meta",name?,desc?}.' },
      preset: { type: 'string', description: 'Create from a shipped preset: ' + PRESETS.map((p) => p.id).join(', ') + '.' },
      name: { type: 'string', description: 'Name for a new dashboard made from a preset.' },
      catalogue: { type: 'boolean', description: 'Return the sources (with their columns) and the widget types.' },
      note: { type: 'string', description: 'One line saying what changed (kept in the dashboard history).' },
    },
    render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    execute: async (raw, exec) => {
      const a = isObj(raw) ? raw : {}
      const sessionId = exec && exec.agent && typeof exec.agent.id === 'string' ? exec.agent.id : null
      if (sessionId === null) return { ok: false, message: 'Cannot identify the current session.' }
      return runTool(host, sessionId, a)
    },
  }
}

const brief = (r) => ({ id: r.id, name: r.dashboard.name, rev: r.rev, widgets: r.dashboard.widgets.map((w) => ({ id: w.id, type: w.type, title: w.title, w: w.w, h: w.h, source: w.source ? w.source.provider : null })) })

export async function runTool (host, sessionId, a) {
  if (a.catalogue === true) {
    const c = describeCatalogue()
    return { ok: true, providers: c.providers, widgets: c.widgets, presets: PRESETS.map((p) => ({ id: p.id, name: p.name, desc: p.desc })) }
  }
  const finish = async (saved, verbOk) => {
    if (!saved.ok) return { ok: false, message: saved.message, conflict: saved.conflict === true, errors: saved.errors }
    host.setCurrent(sessionId, saved.id, saved.dashboard.name)
    const warnings = inspectDashboard(saved.dashboard)
    return {
      ok: true, id: saved.id, name: saved.dashboard.name, rev: saved.rev, widgets: saved.dashboard.widgets.map((w) => ({ id: w.id, type: w.type, title: w.title })),
      dropped: saved.errors.slice(0, 15), warnings: warnings.slice(0, 12),
      message: verbOk + ' The user sees it on the Dashboards page and in the "Dashboard" tab on the right.'
        + (saved.errors.length ? ' ' + saved.errors.length + ' thing(s) were ignored (see dropped).' : '')
        + (warnings.length ? ' ' + warnings.length + ' warning(s): fix them and call again.' : ' No warning.'),
    }
  }
  const note = typeof a.note === 'string' ? a.note : ''
  const hasId = typeof a.id === 'string' && a.id.trim() !== ''
  const id = hasId ? slug(a.id) : null

  if (typeof a.preset === 'string' && a.preset !== '') {
    return finish(await host.fromPreset(a.preset, a.name), 'Created from the preset.')
  }
  if (!hasId) {
    if (isObj(a.dashboard)) return finish(await host.create({ name: typeof a.name === 'string' ? a.name : undefined, raw: a.dashboard, by: 'agent', what: note || 'Created' }), 'Created.')
    const l = await host.list()
    const cur = host.getCurrent(sessionId, true)
    // Say it to the agent too: writing one of these ids replaces the damaged file, so it should tell the person first.
    const damaged = l.unreadable.length > 0 ? l.unreadable.map((u) => ({ id: u.id, message: u.message })) : undefined
    const notes = []
    if (l.dashboards.length === 0) notes.push('No dashboard yet: write one with `dashboard`, or use a `preset`.')
    if (damaged !== undefined) notes.push(damaged.length + ' dashboard file(s) cannot be read (see `unreadable`): tell the person before writing over one of those ids.')
    return {
      ok: true, dashboards: l.dashboards.filter((d) => !d.archived).map((d) => ({ id: d.id, name: d.name, widgets: d.widgets, rev: d.rev })), current: cur ? cur.id : null,
      message: notes.length > 0 ? notes.join(' ') : undefined, unreadable: damaged,
    }
  }
  const r = await host.readDoc(id)
  if (isObj(a.dashboard)) {
    return finish(await host.save({ id, raw: a.dashboard, by: 'agent', what: note || (r.ok ? 'Rewritten' : 'Created') }), r.ok ? 'Replaced.' : 'Created.')
  }
  if (!r.ok) return { ok: false, message: 'There is no dashboard "' + id + '". Write one with `dashboard`.' }
  if (Array.isArray(a.ops) && a.ops.length > 0) {
    const o = applyOps(r.dashboard, a.ops.slice(0, 40))
    const saved = await host.save({ id, raw: o.dashboard, by: 'agent', what: note || ('Edited: ' + a.ops.slice(0, 3).map((x) => (isObj(x) ? x.op : '?')).join(', ')) })
    if (saved.ok) saved.errors = o.errors.concat(saved.errors)
    return finish(saved, 'Saved.')
  }
  host.setCurrent(sessionId, id, r.dashboard.name)
  return {
    ok: true, read: true, ...brief(r), dashboard: r.dashboard, warnings: inspectDashboard(r.dashboard), dropped: r.errors.slice(0, 15),
    changes_by_user: host.userEditsSince(r.history),
  }
}

