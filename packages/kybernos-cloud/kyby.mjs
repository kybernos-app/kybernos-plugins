// Kyby, the DSH side of the person's own assistant (kybernos-server ADR 0053): the Telegram pairing by QR code or link, the setting
// that says where a message runs, the person's one conversation with their Kyby (the thread every door shares) and the message sent
// into it from DSH. This file holds what is pure: the shapes a page may rely on, what a refusal is called, the QR. index.js makes
// the network calls with the account's token and hands this factory what it needs, so every route is tested without a server.
//
// Two rules run through it. The page only ever gets WORDS for a refusal (a server's own text may echo what was sent), and nothing
// returns the token, the pairing's secret part on its own, or the server's raw answer.

import { encodeQr } from './qr.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TURN_ID = /^[A-Za-z0-9_-]{8,64}$/
const BOT = /^[A-Za-z0-9_]{3,64}$/
const START = /^https:\/\/t\.me\/([A-Za-z0-9_]{3,64})\?start=pair_[a-z0-9]{8,64}$/
/** The page asks for a few more messages than it shows; the server caps a page at 200. */
export const CHAT_PAGE = 60
export const MAX_MESSAGE = 100000
export const HOME_TARGETS = Object.freeze(['cloud', 'ask'])
export const PAIRING_STATES = Object.freeze(['waiting', 'scanned', 'done', 'declined', 'expired'])
export const DECLINE_REASONS = Object.freeze(['user', 'taken', 'botmade'])
/** How long the identity of the person's Kyby (kyber, thread, model) is reused: a poll is not a call to /v1/me/kyby. */
const IDENTITY_TTL_MS = 5 * 60 * 1000

/** Codes a page may be told. Anything else the server says is `refused`. */
const KNOWN = Object.freeze([
  'not_found', 'already_linked', 'not_linked', 'rate_limited', 'busy', 'turn_pending', 'model_required', 'model_not_in_plan', 'model_not_found',
  'feature_not_in_plan', 'insufficient_quota', 'payment_past_due', 'budget_not_configured', 'job_bud', 'hosted_busy', 'queue_full',
  'thread_full', 'storage_full', 'hosted_runs_disabled', 'no_runner', 'kyber_archived', 'thread_archived', 'client_turn_conflict',
  'mfa_required_by_workspace', 'plan_required', 'computers_off_for_workspace', 'invalid_request',
])

/** One word for an answer that is not a success. Never the server's text. */
export const codeOf = (res) => {
  if (res === null || typeof res !== 'object') return 'unreachable'
  if (res.status === 0 || res.status === undefined) return 'unreachable'
  if (res.status === 401) return 'not_connected'
  const e = res.body !== null && typeof res.body === 'object' ? res.body.error : undefined
  const code = typeof e === 'string' ? e : (e !== null && typeof e === 'object' && typeof e.code === 'string' ? e.code : '')
  return KNOWN.includes(code) ? code : 'refused'
}

const asObj = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null)
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')

/** The chat's messages as a page draws them: a position, who spoke, the words, when, and the door they came by when the server says. */
export const messagesOf = (rows) => {
  const out = []
  for (const r of Array.isArray(rows) ? rows : []) {
    const m = asObj(r)
    if (m === null) continue
    const role = m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : ''
    if (role === '' || typeof m.content !== 'string' || !Number.isInteger(m.position)) continue
    const meta = asObj(m.crew_meta)
    const via = meta !== null && (meta.source === 'telegram' || meta.source === 'dsh') ? meta.source : null
    out.push({ position: m.position, role, text: m.content.slice(0, MAX_MESSAGE), at: str(m.created_at, 40), via })
  }
  out.sort((a, b) => a.position - b.position)
  return out
}

/** What the page may know of a pairing. `link` is checked: only the bot's own t.me address with a start payload is ever drawn or opened. */
export const pairingOf = (body) => {
  const b = asObj(body)
  if (b === null || typeof b.id !== 'string' || !UUID.test(b.id)) return null
  const link = typeof b.link === 'string' ? b.link : ''
  const m = START.exec(link)
  if (m === null) return null
  return { id: b.id, link, bot: m[1], expires_at: str(b.expires_at, 40) }
}

export const pairingStateOf = (body) => {
  const b = asObj(body)
  if (b === null || !PAIRING_STATES.includes(b.state)) return null
  return {
    state: b.state,
    reason: DECLINE_REASONS.includes(b.reason) ? b.reason : null,
    sender: str(b.sender, 80),
    expires_at: str(b.expires_at, 40),
  }
}

/**
 * @param deps { readState, isConnected, apiCall, deviceLabel, now? } the same helpers index.js already has.
 * Every handler is `(req, body) => Promise<object>` and never throws; a refusal is `{ ok: false, error: <word> }`.
 */
export function createKybyRoutes (deps) {
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const identity = { at: 0, token: '', value: null }

  const session = () => {
    const state = deps.readState()
    return deps.isConnected(state) === true && typeof state.token === 'string' ? state.token : null
  }
  const queryOf = (req) => {
    try { return new URL(String((req && req.url) || ''), 'http://localhost').searchParams } catch (e) { return new URLSearchParams() }
  }

  /** The kyber, thread and model of the person's Kyby, from /v1/me/kyby: kept for a few minutes. */
  const kybyOf = async (token, fresh = false) => {
    if (fresh !== true && identity.value !== null && identity.token === token && now() - identity.at < IDENTITY_TTL_MS) return { ok: true, value: identity.value }
    const res = await deps.apiCall('/v1/me/kyby', { method: 'GET', token, timeoutMs: 15000 })
    const b = res.status === 200 ? asObj(res.body) : null
    if (b === null || typeof b.kyber_id !== 'string' || !UUID.test(b.kyber_id) || typeof b.thread_id !== 'string' || !UUID.test(b.thread_id)) {
      return { ok: false, error: res.status === 200 ? 'refused' : codeOf(res) }
    }
    const value = { kyber_id: b.kyber_id, thread_id: b.thread_id, model: typeof b.model === 'string' && b.model !== '' ? b.model.slice(0, 200) : null }
    identity.at = now()
    identity.token = token
    identity.value = value
    return { ok: true, value }
  }

  return {
    /** POST: asks the server for a pairing and draws its QR. */
    async pairingStart () {
      const token = session()
      if (token === null) return { ok: false, error: 'not_connected' }
      const res = await deps.apiCall('/v1/me/telegram/pairing', { method: 'POST', token, body: { device_label: String(deps.deviceLabel()).slice(0, 60) }, timeoutMs: 15000 })
      if (res.status !== 201 && res.status !== 200) return { ok: false, error: codeOf(res) }
      const p = pairingOf(res.body)
      if (p === null) return { ok: false, error: 'refused' }
      let qr = null
      try {
        const q = encodeQr(p.link, { ecc: 'M' })
        qr = { size: q.size, modules: q.modules }
      } catch (e) { qr = null }
      return { ok: true, ...p, qr }
    },

    /** GET ?id=: where the pairing stands. */
    async pairingState (req) {
      const token = session()
      if (token === null) return { ok: false, error: 'not_connected' }
      const id = queryOf(req).get('id') || ''
      if (!UUID.test(id)) return { ok: false, error: 'invalid_request' }
      const res = await deps.apiCall('/v1/me/telegram/pairing?id=' + encodeURIComponent(id), { method: 'GET', token, timeoutMs: 15000 })
      if (res.status !== 200) return { ok: false, error: codeOf(res) }
      const s = pairingStateOf(res.body)
      return s === null ? { ok: false, error: 'refused' } : { ok: true, ...s }
    },

    /** POST {id}: the person says it is not them. */
    async pairingCancel (req, body) {
      const token = session()
      if (token === null) return { ok: false, error: 'not_connected' }
      const id = body !== null && typeof body === 'object' ? String(body.id || '') : ''
      if (!UUID.test(id)) return { ok: false, error: 'invalid_request' }
      const res = await deps.apiCall('/v1/me/telegram/pairing?id=' + encodeURIComponent(id), { method: 'DELETE', token, timeoutMs: 15000 })
      return res.status === 200 ? { ok: true } : { ok: false, error: codeOf(res) }
    },

    /** POST {home_target}: where a message runs. */
    async settings (req, body) {
      const token = session()
      if (token === null) return { ok: false, error: 'not_connected' }
      const target = body !== null && typeof body === 'object' ? body.home_target : undefined
      if (!HOME_TARGETS.includes(target)) return { ok: false, error: 'invalid_request' }
      const res = await deps.apiCall('/v1/me/telegram/settings', { method: 'PUT', token, body: { home_target: target }, timeoutMs: 15000 })
      const b = res.status === 200 ? asObj(res.body) : null
      return b !== null && HOME_TARGETS.includes(b.home_target) ? { ok: true, home_target: b.home_target } : { ok: false, error: codeOf(res) }
    },

    /** POST: disconnects this account's Telegram (the route needs no recent sign-in; the chat can be linked again at once). */
    async unlink () {
      const token = session()
      if (token === null) return { ok: false, error: 'not_connected' }
      const res = await deps.apiCall('/v1/me/telegram', { method: 'DELETE', token, timeoutMs: 15000 })
      return res.status === 200 ? { ok: true } : { ok: false, error: codeOf(res) }
    },

    /** GET ?after=<position>: the conversation (the last page, or what came after a position). */
    async chat (req) {
      const token = session()
      if (token === null) return { ok: false, error: 'not_connected' }
      const k = await kybyOf(token)
      if (k.ok !== true) return { ok: false, error: k.error }
      const q = queryOf(req)
      const after = Number.parseInt(q.get('after') || '', 10)
      const path = '/v1/threads/' + encodeURIComponent(k.value.thread_id) + '/messages?limit=' + CHAT_PAGE + (Number.isInteger(after) && after >= 0 ? '&after=' + after : '')
      const res = await deps.apiCall(path, { method: 'GET', token, timeoutMs: 15000 })
      if (res.status !== 200) {
        // The thread was deleted since: ask again for the identity next time.
        if (res.status === 404) identity.value = null
        return { ok: false, error: codeOf(res) }
      }
      const b = asObj(res.body)
      const messages = messagesOf(b === null ? [] : b.messages)
      return { ok: true, thread_id: k.value.thread_id, model: k.value.model, messages, has_older: b !== null && b.has_older === true }
    },

    /** POST {message, client_turn_id}: one turn, hosted, on the person's own thread. */
    async send (req, body) {
      const token = session()
      if (token === null) return { ok: false, error: 'not_connected' }
      const b = body !== null && typeof body === 'object' ? body : {}
      const message = typeof b.message === 'string' ? b.message : ''
      if (message.trim() === '' || message.length > MAX_MESSAGE) return { ok: false, error: 'invalid_request' }
      const turn = typeof b.client_turn_id === 'string' ? b.client_turn_id : ''
      if (!TURN_ID.test(turn)) return { ok: false, error: 'invalid_request' }
      const k = await kybyOf(token)
      if (k.ok !== true) return { ok: false, error: k.error }
      const payload = { thread_id: k.value.thread_id, message, client_turn_id: turn, ...(k.value.model === null ? {} : { model: k.value.model }) }
      const res = await deps.apiCall('/v1/kybers/' + encodeURIComponent(k.value.kyber_id) + '/threads/dispatch', { method: 'POST', token, body: payload, timeoutMs: 30000 })
      if (res.status !== 202 && res.status !== 200) {
        if (res.status === 404) identity.value = null
        return { ok: false, error: codeOf(res) }
      }
      const r = asObj(res.body)
      const m = r === null ? null : asObj(r.message)
      return { ok: true, deduplicated: r !== null && r.deduplicated === true, position: m !== null && Number.isInteger(m.position) ? m.position : null }
    },
  }
}
