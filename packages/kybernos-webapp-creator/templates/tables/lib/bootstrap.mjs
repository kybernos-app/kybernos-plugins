// bootstrap.mjs — how the owner gets in, with no sign-up to race for. Pure: the clock, the randomness and the used-link ledger are injected.
//
// The person who starts the app holds `KB_BOOT_KEY`. They mint a link (scripts/mint-link.mjs) that lives a few minutes and works once: `GET /open?t=…` creates the owner
// (or, when there is one already, signs them in again: that is the break-glass) and sets the cookie. Nothing else makes an owner. There is no master password: lose
// the owner's password and you mint another link; suspect the key and you change `KB_BOOT_KEY` and `KB_AUTH_SECRET` and restart (every session and every link dies).
import { randomBytes } from 'node:crypto'
import { signToken, verifyToken } from './token.mjs'

export const OPEN_KIND = 'open'
export const OPEN_TTL_SEC = 10 * 60

/** The ledger of links already used: `claim(nonce, exp)` is true the first time and false after. In memory, for tests; lib/store.mjs keeps the real one on disk. */
export function memoryLedger () {
  const seen = new Set()
  return { claim (nonce) { if (seen.has(nonce)) return false; seen.add(nonce); return true } }
}

/** A link token. `email` is the owner's address for a first opening (the app picks one when it is missing). */
export function mintOpenToken ({ key, now = Date.now, ttlSec = OPEN_TTL_SEC, email, random = randomBytes }) {
  return signToken(OPEN_KIND, { n: random(16).toString('base64url'), ...(typeof email === 'string' && email !== '' ? { e: email } : {}) }, key, { now, ttlSec })
}

/** Checks a link and spends it: `{ ok: true, email }` (email: string | null), or `{ ok: false, reason: 'malformed' | 'bad-signature' | 'expired' | 'reused' }`. */
export function redeemOpenToken (token, { key, now = Date.now, ledger }) {
  const v = verifyToken(OPEN_KIND, token, key, { now })
  if (!v.ok) return v
  const { n, e, x } = v.claims
  if (typeof n !== 'string' || n === '' || n.length > 64) return { ok: false, reason: 'malformed' }
  if (ledger.claim(n, x) !== true) return { ok: false, reason: 'reused' }
  return { ok: true, email: typeof e === 'string' && e !== '' ? e : null }
}
