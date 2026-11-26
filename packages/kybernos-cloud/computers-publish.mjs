// Publishing an automation to one of the person's cloud computers, from the laptop's page (the host half). The page sends the definition it shows; this
// reads six fields of it, refuses what a computer cannot run yet, and hands it to the platform's outbox (`PUT /v1/workspaces/{ws}/computers/{id}/tasks`, the
// server's spec of 2026-10-23). The computer fetches it when it next speaks, applies it, and the page reads how it went (`GET …/tasks`).
//
// Nothing the platform answers goes through as it is: a state is one of three words, a failure is a code from a closed list, a schedule row is its few
// plain fields. The definition holds the prompt, so it is never logged here and never kept: it goes from the page to the platform and no further.

export const REF = /^[A-Za-z0-9_.:-]{1,64}$/u
const SLUG = /^[a-z0-9_-]{2,40}$/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/** Most definitions one call may carry: the page publishes one, or moves one (a put and a delete). */
export const MAX_OPS = 10

/** The codes a failure is told in; anything else the platform says is `refused`. */
export const CODES = Object.freeze([
  'not_connected', 'invalid_request', 'invalid_tasks', 'invalid_definition', 'no_computer', 'not_allowed',
  'approval_path_missing', 'computer_deleting', 'owner_left', 'run_hours_exhausted', 'budget', 'failed_runs', 'owner_locked',
  'too_many_pending', 'rate_limited', 'tasks_unavailable', 'unreachable', 'refused', 'late', 'unknown',
])

const clip = (value, max) => {
  const out = String(value).slice(0, max)
  const last = out.charCodeAt(out.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? out.slice(0, -1) : out
}

/**
 * The six fields of an automation a computer needs, from what the page holds; or the reason it cannot be sent. An automation that asks first (`ask`) goes too: the platform
 * accepts it only for a computer that said it can ask (`ask_approvals`), and the computer's own door accepts it only when its gate is there. Anything else is not sent.
 */
export const definitionOf = (raw) => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid_definition' }
  if (raw.approvals !== 'auto' && raw.approvals !== 'ask') return { ok: false, error: 'approval_path_missing' }
  const name = typeof raw.name === 'string' ? clip(raw.name.trim(), 120) : ''
  const prompt = typeof raw.prompt === 'string' ? clip(raw.prompt.trim(), 8000) : ''
  if (name.replace(/[​-‏⁠﻿]/gu, '').length === 0 || prompt.length === 0) return { ok: false, error: 'invalid_definition' }
  const sc = raw.schedule !== null && typeof raw.schedule === 'object' ? raw.schedule : null
  if (sc === null || (sc.mode !== 'cron' && sc.mode !== 'once' && sc.mode !== 'webhook')) return { ok: false, error: 'invalid_definition' }
  if (typeof sc.tz !== 'string' || sc.tz.trim().length === 0) return { ok: false, error: 'invalid_definition' }
  const schedule = { mode: sc.mode, tz: clip(sc.tz.trim(), 64) }
  if (sc.mode === 'cron') {
    if (typeof sc.cron !== 'string' || sc.cron.trim().length === 0) return { ok: false, error: 'invalid_definition' }
    schedule.cron = clip(sc.cron.trim(), 120)
  }
  if (sc.mode === 'once') {
    if (typeof sc.at !== 'string' || sc.at.trim().length === 0) return { ok: false, error: 'invalid_definition' }
    schedule.at = clip(sc.at.trim(), 40)
  }
  const def = { name, prompt, schedule, active: raw.active !== false, approvals: raw.approvals }
  if (Array.isArray(raw.needs)) def.needs = Array.from(new Set(raw.needs.filter((x) => typeof x === 'string' && SLUG.test(x)))).slice(0, 6)
  return { ok: true, def }
}

/** The ops of a call: `{ op: 'put', ref, task }` or `{ op: 'delete', ref }`, as the platform's `{ op, task_ref, body? }`; or the first reason one cannot be sent. */
export const opsOf = (raw) => {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_OPS) return { ok: false, error: 'invalid_request' }
  const ops = []
  const seen = new Set()
  for (let i = 0; i < raw.length; i += 1) {
    const o = raw[i]
    if (o === null || typeof o !== 'object' || (o.op !== 'put' && o.op !== 'delete') || typeof o.ref !== 'string' || REF.test(o.ref) !== true) return { ok: false, error: 'invalid_request', index: i }
    if (seen.has(o.ref)) return { ok: false, error: 'invalid_request', index: i }
    seen.add(o.ref)
    if (o.op === 'delete') { ops.push({ op: 'delete', task_ref: o.ref }); continue }
    const d = definitionOf(o.task)
    if (d.ok !== true) return { ok: false, error: d.error, index: i }
    ops.push({ op: 'put', task_ref: o.ref, body: d.def })
  }
  return { ok: true, ops }
}

/** True when the SERVER says it has no such route (its answer to an unknown path: 404 `{ error: 'not_found', message: 'No such route.' }`), as against a 404 about a computer or an approval. */
export const routeAbsent = (status, body) => status === 404 && body !== null && typeof body === 'object' && body.error === 'not_found' && /no such route/iu.test(String(body.message === undefined ? '' : body.message))

/** What a refused call is called: the platform's own code when it is on the list, else one from the status. A server that has no outbox yet (the routes are not on every server)
 *  is `tasks_unavailable`, not `no_computer`: the person is told the server cannot keep automations, not that their computer is gone. */
export const codeOf = (status, body) => {
  const given = body !== null && typeof body === 'object' && typeof body.error === 'string' ? body.error : ''
  if (given !== '' && CODES.indexOf(given) >= 0 && given !== 'refused') return given
  if (status === 0) return 'unreachable'
  if (status === 400) return 'invalid_tasks'
  if (status === 403) return 'not_allowed'
  if (routeAbsent(status, body)) return 'tasks_unavailable'
  if (status === 404) return 'no_computer'
  if (status === 422) return 'approval_path_missing'
  if (status === 429) return 'rate_limited'
  if (status === 503) return 'tasks_unavailable'
  return 'refused'
}

const isoOrNull = (v) => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? new Date(t).toISOString() : null }
const STATUSES = Object.freeze(['completed', 'error', 'capped', 'timeout', 'waiting_approval'])

/** The states of the automations sent to a computer, as the page reads them. A state is pending, applied or error; the schedule row is what the computer reported of it. */
export const statesOf = (body) => {
  const list = body !== null && typeof body === 'object' && Array.isArray(body.tasks) ? body.tasks : []
  const out = []
  for (const t of list) {
    if (t === null || typeof t !== 'object' || typeof t.task_ref !== 'string' || REF.test(t.task_ref) !== true) continue
    const state = t.state === 'applied' || t.state === 'error' ? t.state : 'pending'
    const code = state === 'error' && typeof t.error_code === 'string' && /^[a-z0-9_]{1,64}$/u.test(t.error_code) ? t.error_code : null
    const s = t.schedule !== null && typeof t.schedule === 'object' ? t.schedule : null
    out.push({
      ref: t.task_ref,
      state,
      code,
      schedule: s === null ? null : {
        enabled: s.enabled !== false,
        nextRunAt: isoOrNull(s.next_run_at),
        lastRunAt: isoOrNull(s.last_run_at),
        lastStatus: STATUSES.indexOf(s.last_status) >= 0 ? s.last_status : null,
      },
    })
    if (out.length >= 50) break
  }
  return out
}

const VIAS = Object.freeze(['cron', 'once', 'webhook', 'run_now'])
const KINDS = Object.freeze(['shell', 'write', 'edit', 'connector', 'other'])
const APPROVAL_STATES = Object.freeze(['pending', 'allowed', 'allowed_turn', 'denied', 'expired'])
const DECISIONS = Object.freeze(['allowed', 'allowed_turn', 'denied'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/gu

/**
 * The runs a computer reported ended, as the page reads them (the platform's `GET …/runs`): newest first, at most 100. A run is its id, the automation's id, how
 * it was started, how it ended (one of five words) and when; the one reason it may carry is a short code. The platform keeps nothing else of a run, and neither does this.
 */
export const runsOf = (body) => {
  const list = body !== null && typeof body === 'object' && Array.isArray(body.runs) ? body.runs : []
  const out = []
  for (const r of list) {
    if (r === null || typeof r !== 'object' || typeof r.task_ref !== 'string' || REF.test(r.task_ref) !== true) continue
    const endedAt = isoOrNull(r.ended_at)
    if (endedAt === null || STATUSES.indexOf(r.outcome) < 0) continue
    out.push({
      key: typeof r.run_key === 'string' && REF.test(r.run_key) === true ? r.run_key : endedAt + ':' + r.task_ref,
      ref: r.task_ref,
      via: VIAS.indexOf(r.via) >= 0 ? r.via : null,
      outcome: r.outcome,
      reason: typeof r.reason === 'string' && /^[a-z0-9_]{1,64}$/u.test(r.reason) ? r.reason : null,
      startedAt: isoOrNull(r.started_at) ?? endedAt,
      endedAt,
    })
    if (out.length >= 100) break
  }
  return out
}

/**
 * What the computer's automations asked their person before acting, as the page reads it (the platform's `GET …/approvals`): pending first, then what was answered or ran out
 * in the last day, at most 50. `summary` is what the action will do (a command line, a path, a connector's call): it is shown to its owner and nowhere else, and it is
 * clipped and cleaned of control characters here. The kind, the state and who answered are words from closed lists.
 */
export const approvalsOf = (body) => {
  const list = body !== null && typeof body === 'object' && Array.isArray(body.approvals) ? body.approvals : []
  const out = []
  for (const a of list) {
    if (a === null || typeof a !== 'object' || typeof a.id !== 'string' || UUID_RE.test(a.id) !== true) continue
    if (typeof a.task_ref !== 'string' || REF.test(a.task_ref) !== true) continue
    if (APPROVAL_STATES.indexOf(a.state) < 0) continue
    const expiresAt = isoOrNull(a.expires_at)
    if (expiresAt === null) continue
    out.push({
      id: a.id,
      ref: a.task_ref,
      runKey: typeof a.run_key === 'string' && REF.test(a.run_key) === true ? a.run_key : null,
      kind: KINDS.indexOf(a.kind) >= 0 ? a.kind : 'other',
      summary: clip(String(a.summary ?? '').replace(CONTROL, ' ').replace(/\s+/gu, ' ').trim(), 400),
      state: a.state,
      createdAt: isoOrNull(a.created_at) ?? expiresAt,
      expiresAt,
      decidedAt: isoOrNull(a.decided_at),
      via: a.decided_via === 'app' || a.decided_via === 'channel' ? a.decided_via : null,
      notified: a.notified === true,
    })
    if (out.length >= 50) break
  }
  return out
}

/** The calls of the page, against the platform with the account's token (nothing is called when nobody is connected). */
export function createPublish ({ readState, isConnected, apiCall }) {
  const personalWorkspace = async (token) => {
    const ws = await apiCall('/v1/workspaces', { method: 'GET', token, timeoutMs: 15000 })
    const list = ws.status === 200 && ws.body !== null && typeof ws.body === 'object' && Array.isArray(ws.body.workspaces) ? ws.body.workspaces : []
    const personal = list.find((w) => w !== null && typeof w === 'object' && w.personal === true && typeof w.id === 'string')
    return personal === undefined ? null : personal.id
  }
  const pathOf = (workspaceId, computerId, leaf = 'tasks') => '/v1/workspaces/' + encodeURIComponent(workspaceId) + '/computers/' + encodeURIComponent(computerId) + '/' + leaf

  /** `{ computerId, ops: [{ op, ref, task? }] }` → `{ ok: true, ops: [{ ref, state }] }` or `{ ok: false, error, index? }`. */
  const publish = async (body) => {
    const state = readState()
    if (!isConnected(state)) return { ok: false, error: 'not_connected' }
    if (body === null || typeof body !== 'object' || typeof body.computerId !== 'string' || UUID.test(body.computerId) !== true) return { ok: false, error: 'invalid_request' }
    const parsed = opsOf(body.ops)
    if (parsed.ok !== true) return parsed.index === undefined ? { ok: false, error: parsed.error } : { ok: false, error: parsed.error, index: parsed.index }
    const ws = await personalWorkspace(state.token)
    if (ws === null) return { ok: false, error: 'no_computer' }
    const res = await apiCall(pathOf(ws, body.computerId), { method: 'PUT', token: state.token, body: { ops: parsed.ops }, timeoutMs: 25000 })
    if (res.status !== 202) return { ok: false, error: codeOf(res.status, res.body), status: res.status }
    const sent = res.body !== null && typeof res.body === 'object' && Array.isArray(res.body.ops) ? res.body.ops : []
    return { ok: true, ops: sent.filter((o) => o !== null && typeof o === 'object' && typeof o.task_ref === 'string' && REF.test(o.task_ref) === true).map((o) => ({ ref: o.task_ref, state: 'pending' })) }
  }

  /** `computerId` → `{ ok: true, tasks: [{ ref, state, code, schedule }] }` or `{ ok: false, error }`. */
  const states = async (query) => {
    const state = readState()
    if (!isConnected(state)) return { ok: false, error: 'not_connected' }
    const id = query !== null && query !== undefined && typeof query.get === 'function' ? String(query.get('computerId') || '') : ''
    if (UUID.test(id) !== true) return { ok: false, error: 'invalid_request' }
    const ws = await personalWorkspace(state.token)
    if (ws === null) return { ok: false, error: 'no_computer' }
    const res = await apiCall(pathOf(ws, id), { method: 'GET', token: state.token, timeoutMs: 15000 })
    if (res.status !== 200) return { ok: false, error: codeOf(res.status, res.body), status: res.status }
    return { ok: true, tasks: statesOf(res.body) }
  }

  /** `computerId` and, for one automation's runs, `ref` → `{ ok: true, runs: [{ key, ref, via, outcome, reason, startedAt, endedAt }] }` or `{ ok: false, error }`. */
  const runs = async (query) => {
    const state = readState()
    if (!isConnected(state)) return { ok: false, error: 'not_connected' }
    const get = (name) => (query !== null && query !== undefined && typeof query.get === 'function' ? String(query.get(name) || '') : '')
    const id = get('computerId')
    const ref = get('ref')
    if (UUID.test(id) !== true || (ref !== '' && REF.test(ref) !== true)) return { ok: false, error: 'invalid_request' }
    const ws = await personalWorkspace(state.token)
    if (ws === null) return { ok: false, error: 'no_computer' }
    const res = await apiCall(pathOf(ws, id, 'runs') + (ref === '' ? '?limit=100' : '?limit=50&task_ref=' + encodeURIComponent(ref)), { method: 'GET', token: state.token, timeoutMs: 15000 })
    if (res.status !== 200) return { ok: false, error: codeOf(res.status, res.body), status: res.status }
    return { ok: true, runs: runsOf(res.body) }
  }

  /** `computerId` → `{ ok: true, approvals: [...] }` (what its automations asked) or `{ ok: false, error }`. */
  const approvals = async (query) => {
    const state = readState()
    if (!isConnected(state)) return { ok: false, error: 'not_connected' }
    const id = query !== null && query !== undefined && typeof query.get === 'function' ? String(query.get('computerId') || '') : ''
    if (UUID.test(id) !== true) return { ok: false, error: 'invalid_request' }
    const ws = await personalWorkspace(state.token)
    if (ws === null) return { ok: false, error: 'no_computer' }
    const res = await apiCall(pathOf(ws, id, 'approvals'), { method: 'GET', token: state.token, timeoutMs: 15000 })
    if (res.status !== 200) return { ok: false, error: codeOf(res.status, res.body), status: res.status }
    return { ok: true, approvals: approvalsOf(res.body) }
  }

  /** `{ computerId, id, decision }` → `{ ok: true, state }` or `{ ok: false, error }` (`late`: it was answered, or ran out; `unknown`: it is not there). */
  const decide = async (body) => {
    const state = readState()
    if (!isConnected(state)) return { ok: false, error: 'not_connected' }
    if (body === null || typeof body !== 'object' || typeof body.computerId !== 'string' || UUID.test(body.computerId) !== true) return { ok: false, error: 'invalid_request' }
    if (typeof body.id !== 'string' || UUID_RE.test(body.id) !== true || DECISIONS.indexOf(body.decision) < 0) return { ok: false, error: 'invalid_request' }
    const ws = await personalWorkspace(state.token)
    if (ws === null) return { ok: false, error: 'no_computer' }
    const res = await apiCall(pathOf(ws, body.computerId, 'approvals/' + encodeURIComponent(body.id) + '/decide'), { method: 'POST', token: state.token, body: { decision: body.decision }, timeoutMs: 15000 })
    if (res.status === 409) return { ok: false, error: 'late', status: 409 }
    if (res.status === 404 && routeAbsent(res.status, res.body) !== true) return { ok: false, error: 'unknown', status: 404 }
    if (res.status !== 200) return { ok: false, error: codeOf(res.status, res.body), status: res.status }
    const said = res.body !== null && typeof res.body === 'object' && APPROVAL_STATES.indexOf(res.body.state) >= 0 ? res.body.state : body.decision
    return { ok: true, state: said }
  }

  return { publish, states, runs, approvals, decide }
}
