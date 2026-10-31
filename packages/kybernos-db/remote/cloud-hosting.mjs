// cloud-hosting.mjs — the real hosting port: the person's own Kybernos cloud computers, reached through the account the cloud bundle holds.
// The contract is docs/dev/apps-hosting-port.md; the server side is the team-space routes of the active workspace (kybernos-server, ADR 0061 section 12):
//
//   hosts()        GET    /v1/workspaces/<active>/team-space/hosts          the computers, each with its state, region, "always on" and "shared"
//   ensureSpace()  POST   /v1/workspaces/<active>/team-space { host }       200 once the app answers, 202 while the computer or the app starts (asked again here)
//   releaseSpace() DELETE /v1/workspaces/<active>/team-space?space=<id>
//
// This file never sees the account token. It reaches the server through `globalThis[Symbol.for('kybernos.cloud')]` (kybernos-cloud adds the token, allows only these three routes and
// only for the workspace the person has active). The seam is looked up at every call, never kept: the cloud bundle may be mounted after this one, switched off or signed out, and then
// Publish is simply not offered. It answers the boot key to the publisher and nobody else, and it never writes it anywhere.
//
// Every message a person may read is written here in plain English; the server's own text is never passed on. Nothing is built from the server's answer but known fields.
import { cleanOrderUrl } from './hosting.mjs'
import { SPACE_ID } from './registry.mjs'

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
/** How long a verdict about the server (it publishes, or it does not) is believed before it is asked again. */
export const VERDICT_OK_MS = 5 * 60 * 1000
export const VERDICT_NO_MS = 5 * 60 * 1000
/** After an answer that proves nothing (the network, a busy server, a signed-out account) the verdict is kept and the question is asked again after this. */
export const VERDICT_RETRY_MS = 60 * 1000
/** A computer that wakes and a hosted app that boots take a minute or two; past this `ensureSpace` gives up and says so. */
export const ENSURE_MAX_MS = 5 * 60 * 1000
const RETRY_MIN_MS = 2000
const RETRY_MAX_MS = 30 * 1000
const RETRY_DEFAULT_MS = 5000
const WORKSPACE_ID = /^[A-Za-z0-9_-]{1,64}$/

const SAY = {
  signedOut: 'Sign in to your Kybernos account to publish.',
  sessionEnded: 'Your Kybernos session ended. Sign in again, then try again.',
  forbidden: 'Only an owner or an admin of your workspace can publish a web app.',
  noRoutes: 'Your Kybernos server does not host web apps yet.',
  off: 'Hosting web apps is switched off on your Kybernos server.',
  network: 'Check your connection, then try again.',
  busy: 'Your Kybernos server is busy. Try again in a minute.',
  broken: 'Your Kybernos server could not start the web app. Try again later.',
  workspace: 'Your active workspace changed. Open Publish again.',
  unknownHost: 'That is not one of your cloud computers any more. Pick another one.',
  hostGone: 'That cloud computer was deleted. Pick another one.',
  hostUnavailable: 'That cloud computer cannot be started now. Check it in your Kybernos console, or pick another one.',
  budget: 'Your cloud budget cannot pay for this computer now. Add credit in your Kybernos console, then try again.',
  slow: 'The computer is taking too long to start. Try again in a few minutes.',
  frozen: 'The web app on this computer is read-only for a moment. Try again in a minute.',
  notReady: 'The web app on this computer did not answer. Try again in a few minutes.',
}

const refuse = (code, message) => ({ ok: false, code, message })

/**
 * What a failed answer of the seam means, as a refusal of the port. `status` 0 is the network or the seam itself; the server's own `error` code (a string on the body) tells the
 * rest apart. Anything not known is a generic failure to start, never the server's own words.
 */
export function refusalOf (r) {
  const status = plain(r) && Number.isFinite(r.status) ? r.status : 0
  const err = plain(r) && plain(r.body) && typeof r.body.error === 'string' ? r.body.error : ''
  const seamError = plain(r) && typeof r.error === 'string' ? r.error : ''
  if (status === 0) {
    if (seamError === 'not_connected') return refuse('unavailable', SAY.signedOut)
    if (seamError === 'workspace_refused') return refuse('hosting-failed', SAY.workspace)
    return refuse('hosting-failed', SAY.network)
  }
  if (status === 401) return refuse('unavailable', SAY.sessionEnded)
  if (status === 403) return refuse('forbidden', SAY.forbidden)
  if (status === 404) return err === 'unknown_host' ? refuse('unknown-host', SAY.unknownHost) : refuse('unavailable', SAY.noRoutes)
  if (status === 409) {
    if (err === 'host_gone') return refuse('host-gone', SAY.hostGone)
    if (err === 'host_unavailable') return refuse('host-unavailable', SAY.hostUnavailable)
    if (err === 'budget_exhausted') return refuse('budget', SAY.budget)
    if (err === 'host_required') return refuse('unknown-host', SAY.unknownHost)
    return refuse('hosting-failed', SAY.broken)
  }
  if (status === 429) return refuse('hosting-failed', SAY.busy)
  if (status === 503 && err === 'teamspace_disabled') return refuse('unavailable', SAY.off)
  return refuse('hosting-failed', SAY.broken)
}

/** One computer as the server described it, in the port's words. A value of another type becomes nothing; the plugin cleans the rest (`readHosts`). */
function hostOf (raw) {
  if (!plain(raw)) return null
  const label = typeof raw.region_label === 'string' && raw.region_label.trim() !== '' ? raw.region_label : raw.region
  return { id: raw.id, name: raw.name, state: raw.state, region: typeof label === 'string' ? label : '', alwaysOn: raw.always_on === true, shared: raw.shared === true }
}

/**
 * The hosting of a DSH signed in to a Kybernos account. Injected for a test: `seam()` (what `globalThis[Symbol.for('kybernos.cloud')]` is), `now()`, `wait(ms)` (a sleep) and the
 * two limits. Without a seam (the cloud bundle absent or signed out) it is never available and never asks anything.
 */
export function cloudHosting ({ seam = () => globalThis[Symbol.for('kybernos.cloud')], now = Date.now, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), ensureMaxMs = ENSURE_MAX_MS } = {}) {
  /** The seam and the active workspace's path, or null (no seam, signed out, no workspace). Synchronous: it reads a state file, it asks no one. */
  const base = () => {
    try {
      const s = seam()
      if (!plain(s) || typeof s.call !== 'function' || typeof s.workspace !== 'function') return null
      const workspace = s.workspace()
      return typeof workspace === 'string' && WORKSPACE_ID.test(workspace) ? { s, workspace, path: '/v1/workspaces/' + workspace + '/team-space' } : null
    } catch (e) { return null }
  }

  // What the server last said about this workspace: { workspace, ok, until, orderUrl }. `until` is when it is asked again. A verdict of another workspace is no verdict.
  let verdict = null
  let flight = null
  const settle = (workspace, ok, ttl, orderUrl) => {
    const same = verdict !== null && verdict.workspace === workspace
    verdict = { workspace, ok: ok === null ? (same && verdict.ok) : ok, until: now() + ttl, orderUrl: orderUrl !== undefined ? orderUrl : (same ? verdict.orderUrl : '') }
  }
  /** One read of the computers. It also keeps the verdict and the address that orders another one. Never throws. */
  async function read (b) {
    let r
    try { r = await b.s.call(b.path + '/hosts', { method: 'GET' }) } catch (e) { r = { status: 0, body: null, error: 'seam_failed' } }
    if (plain(r) && r.status === 200 && plain(r.body) && Array.isArray(r.body.hosts)) {
      settle(b.workspace, true, VERDICT_OK_MS, cleanOrderUrl(r.body.order_url))
      return { ok: true, hosts: r.body.hosts.map(hostOf).filter((h) => h !== null) }
    }
    const out = refusalOf(r)
    const status = plain(r) ? r.status : 0
    // the server says it does not publish (no such route, switched off) or that this person may not: believed for a while. Anything else proves nothing.
    if (status === 403 || status === 404 || (status === 503 && out.code === 'unavailable')) settle(b.workspace, false, VERDICT_NO_MS, '')
    else settle(b.workspace, null, VERDICT_RETRY_MS)
    return out
  }

  return Object.freeze({
    /**
     * Whether Publish is offered. Synchronous, so it answers what the server last said: true only after a read of the computers succeeded for the active workspace (a server without
     * the routes, a switched-off hosting, or a member who is not an owner or an admin never gets a button). While that is not known, or has aged, one read is started in the background;
     * a first answer after a start is therefore "no", and the button appears on the next look.
     */
    available () {
      const b = base()
      if (b === null) return false
      const mine = verdict !== null && verdict.workspace === b.workspace
      if ((!mine || now() >= verdict.until) && flight === null) flight = read(b).catch(() => null).finally(() => { flight = null })
      return mine && verdict.ok === true
    },
    describe () {
      const b = base()
      const mine = b !== null && verdict !== null && verdict.workspace === b.workspace
      return { name: 'Kybernos', ...(mine && verdict.orderUrl !== '' ? { orderUrl: verdict.orderUrl } : {}) }
    },
    async hosts () {
      const b = base()
      if (b === null) return refuse('unavailable', SAY.signedOut)
      return read(b)
    },
    async ensureSpace (arg) {
      const host = plain(arg) && typeof arg.host === 'string' && SPACE_ID.test(arg.host) ? arg.host : null
      if (host === null) return refuse('unknown-host', SAY.unknownHost)
      const b = base()
      if (b === null) return refuse('unavailable', SAY.signedOut)
      const deadline = now() + ensureMaxMs
      for (;;) {
        let r
        try { r = await b.s.call(b.path, { method: 'POST', body: { host } }) } catch (e) { r = { status: 0, body: null, error: 'seam_failed' } }
        if (!plain(r) || (r.status !== 200 && r.status !== 202)) return refusalOf(r)
        const v = r.body
        if (!plain(v)) return refuse('hosting-failed', SAY.broken)
        if (v.ready === true) {
          const s = v.space
          if (!plain(s) || typeof s.id !== 'string' || typeof s.url !== 'string' || typeof s.boot_key !== 'string') return refuse('hosting-failed', SAY.notReady)
          if (v.frozen === true) return refuse('host-unavailable', SAY.frozen)
          return { ok: true, space: { id: s.id, url: s.url, bootKey: s.boot_key } }
        }
        // still starting: the server holds no request, it says when to ask again
        const after = Number.isFinite(v.retry_after_seconds) ? Math.min(Math.max(v.retry_after_seconds * 1000, RETRY_MIN_MS), RETRY_MAX_MS) : RETRY_DEFAULT_MS
        if (now() + after >= deadline) return refuse('host-unavailable', SAY.slow)
        await wait(after)
      }
    },
    async releaseSpace (spaceId) {
      if (typeof spaceId !== 'string' || !SPACE_ID.test(spaceId)) return { ok: false }
      const b = base()
      if (b === null) return { ok: false }
      let r
      try { r = await b.s.call(b.path + '?space=' + spaceId, { method: 'DELETE' }) } catch (e) { return { ok: false } }
      // A 404 is not taken for "already given back": it is also what another workspace answers, and a space forgotten here is a space whose key is lost.
      return { ok: plain(r) && r.status === 200 && plain(r.body) && r.body.released === true }
    },
  })
}
