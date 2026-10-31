// hosting.mjs — the PORT through which Publish finds the person's cloud computers and gets a team space on the one they choose, and the two implementations this repository has.
// The contract the real one (the server, L6) must keep is docs/dev/apps-hosting-port.md.
//
//   hosting = {
//     available(): boolean                  whether Publish is offered at all; false means no button, no card, no dead control
//     describe(): { name, orderUrl? }       what the Publish card calls the thing it publishes into, and the https address that orders another computer (plain data, no secret)
//     hosts(): Promise<{ ok: true, hosts: Host[] } | { ok: false, code, message }>      the person's own cloud computers, read when the card opens
//     ensureSpace({ host }): Promise<{ ok: true, space: { id, url, bootKey } } | { ok: false, code, message }>      the hosted app on that computer, once it answers
//     releaseSpace?(spaceId): Promise<{ ok: boolean }>     when the last app leaves a space (optional)
//   }
//   Host = { id, name, state: 'running' | 'sleeping' | 'starting' | 'stopped', region?, alwaysOn?, shared? }
//
// The default answers `available: false`: the product shows no Publish control until a real hosting is wired. `envHosting` points at ONE space somebody already runs, from two
// environment variables; it is for development and self-hosting, it is chosen by the host process and never by a request, and it is not the default.
import { SPACE_ID } from './registry.mjs'
import { normalizeSpaceUrl } from './space.mjs'
import { hexKey } from './token.mjs'

const NOT_AVAILABLE = 'Publishing is not available yet.'
/** At most this many computers are read from one answer; the rest is dropped. */
export const HOSTS_MAX = 50
/** `hosts()` is a read the card waits for: past this the card says the computers could not be listed. (`ensureSpace` has no limit of its own: it is a button the person pressed.) */
export const HOSTS_TIMEOUT_MS = 15 * 1000
export const HOST_STATES = Object.freeze(['running', 'sleeping', 'starting', 'stopped'])
const HOSTS_FAILED = 'Check your connection, then try again.'

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
/** A string from the port, whitespace and control characters folded to one space, cut at `n` characters; anything that is not a string is the empty string. */
const text = (v, n) => (typeof v === 'string' ? Array.from(v.replace(/[\s\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim()).slice(0, n).join('') : '')

/** The hosting of a product that has none: nothing to publish into, so nothing is offered. */
export const unavailableHosting = () => Object.freeze({
  available: () => false,
  describe: () => ({ name: '' }),
  hosts: async () => ({ ok: false, code: 'unavailable', message: NOT_AVAILABLE }),
  ensureSpace: async () => ({ ok: false, code: 'unavailable', message: NOT_AVAILABLE }),
})

/** The address that orders another cloud computer, or '': an `https://` address with a host and no credentials, as the port gave it (it is never built, completed or changed here). */
export function cleanOrderUrl (v) {
  if (typeof v !== 'string' || v.length === 0 || v.length > 2000 || /[\s\p{Cc}]/u.test(v)) return ''
  let u
  try { u = new URL(v) } catch (e) { return '' }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.hostname === '') return ''
  return v
}

/** What a card may show of a hosting's description: known keys, plain values, bounded. */
export function describeHosting (hosting) {
  let d = null
  try { d = hosting.describe() } catch (e) { d = null }
  const o = plain(d) ? d : {}
  return { name: text(o.name, 80), orderUrl: cleanOrderUrl(o.orderUrl) }
}

/** One computer as the port described it, or null when it cannot be told apart from the others (no usable id). Anything else that is not what it should be becomes nothing, never a claim. */
function cleanHost (raw) {
  if (!plain(raw) || typeof raw.id !== 'string' || !SPACE_ID.test(raw.id)) return null
  return {
    id: raw.id,
    name: text(raw.name, 80) || raw.id,
    state: HOST_STATES.includes(raw.state) ? raw.state : 'stopped',
    region: text(raw.region, 80),
    alwaysOn: raw.alwaysOn === true,
    shared: raw.shared === true,
  }
}

/**
 * The person's computers, as a card may show them: `{ ok: true, hosts }` (possibly empty, which is a valid answer) or `{ ok: false, code: 'hosts-unreachable', message }`. It never throws and never
 * waits for ever: a port that throws, answers something else than the contract, or does not answer within `timeoutMs` is "could not be listed". The `message` of a refusal is the port's own
 * (plain English, at most 300 characters) or a generic one.
 */
export async function readHosts (hosting, { timers = {}, timeoutMs = HOSTS_TIMEOUT_MS } = {}) {
  const failed = (message) => ({ ok: false, code: 'hosts-unreachable', message: text(message, 300) || HOSTS_FAILED })
  const setT = typeof timers.setTimeout === 'function' ? timers.setTimeout : setTimeout
  const clearT = typeof timers.clearTimeout === 'function' ? timers.clearTimeout : clearTimeout
  let handle = null
  try {
    if (hosting === null || typeof hosting !== 'object' || typeof hosting.hosts !== 'function') return failed('')
    const late = new Promise((resolve) => {
      handle = setT(() => resolve(null), timeoutMs)
      if (handle !== null && handle !== undefined && typeof handle.unref === 'function') handle.unref()
    })
    const answer = await Promise.race([Promise.resolve().then(() => hosting.hosts()), late])
    if (!plain(answer)) return failed('')
    if (answer.ok === false) return failed(answer.message)
    if (answer.ok !== true || !Array.isArray(answer.hosts)) return failed('')
    const seen = new Set()
    const hosts = []
    for (const raw of answer.hosts) {
      const h = cleanHost(raw)
      if (h === null || seen.has(h.id)) continue
      seen.add(h.id)
      hosts.push(h)
      if (hosts.length >= HOSTS_MAX) break
    }
    return { ok: true, hosts }
  } catch (e) {
    return failed('')
  } finally {
    try { if (handle !== null && handle !== undefined) clearT(handle) } catch (e) { /* the timer is gone */ }
  }
}

/**
 * A hosting that points at one team space somebody runs already (development, or self-hosting): `KYBERNOS_DB_SPACE_URL` (its origin) and `KYBERNOS_DB_SPACE_KEY` (its boot key,
 * hex), and optionally `KYBERNOS_DB_ORDER_URL` (an https address for the order button). Without the first two, or with either unusable, it is the unavailable hosting. It makes no request itself:
 * `hosts()` lists that one space as a running computer, and `ensureSpace` hands back the configured space for that computer only.
 */
export function envHosting (env = process.env) {
  const url = normalizeSpaceUrl(env.KYBERNOS_DB_SPACE_URL)
  const key = typeof env.KYBERNOS_DB_SPACE_KEY === 'string' ? env.KYBERNOS_DB_SPACE_KEY.trim() : ''
  if (url === null || hexKey(key) === null) return unavailableHosting()
  const id = 'env-' + new URL(url).host.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 40)
  const name = 'Your own team space'
  const orderUrl = cleanOrderUrl(typeof env.KYBERNOS_DB_ORDER_URL === 'string' ? env.KYBERNOS_DB_ORDER_URL.trim() : '')
  return Object.freeze({
    available: () => true,
    describe: () => ({ name, ...(orderUrl !== '' ? { orderUrl } : {}) }),
    hosts: async () => ({ ok: true, hosts: [{ id, name, state: 'running' }] }),
    ensureSpace: async (arg) => (plain(arg) && arg.host === id
      ? { ok: true, space: { id, url, bootKey: key } }
      : { ok: false, code: 'unknown-host', message: 'That is not the computer this adapter points at.' }),
  })
}
