// kybernos-call: the one-run credential of the call worker.
//
// The call worker (agent/agent.py) is a program, not a browser: it cannot carry DSH's signed session cookie, so the routes it calls
// (`utterance`, `speech`, and the core's voice routes) used to rest on an Origin header alone, which any local program can send
// (recette L3-03: a forged Origin injected a turn into a real session, and the host itself added the signed cookie on its way).
//
// The host now gives each worker run a random secret, put in the worker's environment (KYBER_CALL_TOKEN) and nowhere else: the host keeps
// only a SHA-256 digest of it in memory, so there is nothing to read back, and it is never logged, never written to a file and never
// returned to a page. The worker presents it in the `x-kybernos-call-token` header; the check compares digests in constant time.
// The secret lives exactly as long as that worker run: it is dropped when the worker is stopped, when it exits, when a new one is
// started and when the plugin stops.
//
// Bundles import nothing from one another, so the core's routes reach the check through a process-global slot (`Symbol.for`, like the
// trusted-authority hook): this file publishes a function that answers « is this request the call worker? » and nothing else. Without
// this bundle the slot is empty and those routes accept the signed session cookie only.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { writeGuard } from './session-guard.mjs'

export const TOKEN_HEADER = 'x-kybernos-call-token'
export const TOKEN_ENV = 'KYBER_CALL_TOKEN'
export const SLOT = Symbol.for('kybernos.callWorkerToken')
// The phone's relay marks every request it replays with the computer's own cookie; that is never the worker.
const TUNNEL_HEADER = 'x-kybernos-tunnel'

const digestOf = (text) => createHash('sha256').update(String(text), 'utf8').digest()

/** The credential of the current worker run. `issue()` returns the secret once, for the worker's environment; nothing else ever does. */
export function createWorkerToken () {
  let digest = null
  return {
    issue () {
      const secret = randomBytes(32).toString('hex')
      digest = digestOf(secret)
      return secret
    },
    revoke () { digest = null },
    /** Does this request carry the current worker's secret? (A relayed phone request never does.) */
    accepts (req) {
      try {
        if (digest === null) return false
        const headers = (req !== null && req !== undefined && req.headers !== null && req.headers !== undefined) ? req.headers : {}
        if (headers[TUNNEL_HEADER] !== undefined) return false
        const presented = headers[TOKEN_HEADER]
        if (typeof presented !== 'string' || presented.length === 0 || presented.length > 256) return false
        return timingSafeEqual(digestOf(presented), digest)
      } catch (e) { return false }
    }
  }
}

/** Puts the check where the core's routes can find it; returns the function that takes it away again (only if it is still this one). */
export function publishWorkerCheck (accepts) {
  const check = (req) => accepts(req) === true
  globalThis[SLOT] = check
  return () => { if (globalThis[SLOT] === check) delete globalThis[SLOT] }
}

/**
 * The guard of a route the worker calls as well as a page: `null` lets the request go on, otherwise `{ status, error }` is the refusal.
 * The worker's secret is enough on its own (it has no cookie); anything else needs the strict Origin AND DSH's signed session, as for every
 * other write of the bundle. The caller has already refused a request whose Origin is not this listener's.
 */
export function workerOrSession (req, accepts) {
  if (typeof accepts === 'function' && accepts(req) === true) return null
  return writeGuard(req)
}
