// Pure rules for wiring DSH's `opencode-free` route to the gateway THIS bundle mounts.
//
// Two things were wrong in the field, and both end the same way, a chat that cannot answer:
//   1. the route pointed at 127.0.0.1:8848, the port of the proof-of-concept bridge, while the gateway this bundle
//      mounts is served by DSH's own web server under /free-llms/v1: nothing listened where the route pointed;
//   2. the route names `OPENCODE_FREE_API_KEY` as its key, and nothing ever stored it, so llm-pi-ai refused the turn
//      with MISSING_CREDENTIAL before any request left the machine.
//
// No I/O here: index.js hands this the values it read (ports, the credentials service) and writes what comes back.

export const GATEWAY_PATH = '/free-llms/v1'
/** DSH's default web port; only the last resort when neither the server nor the environment says. */
export const DEFAULT_PORT = 3080
/** The free tier accepts this literal marker (measured: it routes to the zero-cost tier). Not a secret. */
export const FREE_TIER_KEY = 'public'

const portOf = (value) => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null
}

/** The port of a `Host` header, only when the host is a loopback name (a public host says nothing about DSH's own port). */
export const loopbackPortOf = (hostHeader) => {
  if (typeof hostHeader !== 'string') return null
  const m = /^(?:127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})$/i.exec(hostHeader.trim())
  return m === null ? null : portOf(m[1])
}

/**
 * The address DSH's engine must call to reach the gateway: the loopback address of DSH's own web server.
 * Sources, in order: the port the web server reports, DSH_PORT, the port of a loopback `Host` header, DSH's default.
 */
export const gatewayBase = ({ serverPort, envPort, hostHeader } = {}) => {
  const port = portOf(serverPort) ?? portOf(envPort) ?? loopbackPortOf(hostHeader) ?? DEFAULT_PORT
  return 'http://127.0.0.1:' + port + GATEWAY_PATH
}

/** Whether a route written by an earlier version (or for another port) must be written again. */
export const routeNeedsRepair = (state, base) =>
  state !== null && typeof state === 'object' && state.wired === true && state.routeBase !== base

/**
 * Make the route's key resolvable. A value that is already there (a person's own key, or a previous run) is never
 * overwritten. `credentials` is DSH's credentials service (`describe`, `set`).
 *
 * @returns {Promise<'present'|'stored'|'unavailable'|'read_only'|'failed'>}
 */
export const ensureFreeKey = async (credentials, ref) => {
  if (credentials === null || typeof credentials !== 'object') return 'unavailable'
  if (typeof credentials.describe !== 'function' || typeof credentials.set !== 'function') return 'unavailable'
  try {
    const info = await credentials.describe(ref)
    if (info !== null && typeof info === 'object') {
      if (info.configured === true) return 'present'
      if (info.writable === false) return 'read_only'
    }
    await credentials.set(ref, FREE_TIER_KEY)
    return 'stored'
  } catch (e) {
    return 'failed'
  }
}
