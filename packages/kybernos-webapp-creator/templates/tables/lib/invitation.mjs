// invitation.mjs — the token of an invitation, and the rules that decide whether a stored invitation can still be used. Pure.
//
// The token only says « invitation <id>, version <nonce> », signed with a key derived from `KB_AUTH_SECRET`. What the invitation gives (the profile id, the address it is for) is read
// from the row the owner made, so changing the profile of a pending invitation changes what the link gives, and a resend (a new nonce) kills the old link.
import { createHmac, randomBytes } from 'node:crypto'
import { signToken, verifyToken } from './token.mjs'

export const INVITE_KIND = 'invite'
export const INVITE_TTL_SEC = 7 * 24 * 3600
const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/

/** The signing key of invitations, derived so that it is not the key of anything else. */
export const inviteKey = (authSecret) => createHmac('sha256', authSecret).update('kybernos-tables/invitation').digest()

/** A normal address, lower case, or null. */
export function normEmail (s) {
  if (typeof s !== 'string') return null
  const e = s.trim().toLowerCase()
  return e.length <= 254 && EMAIL.test(e) ? e : null
}

export const newNonce = (random = randomBytes) => random(16).toString('base64url')
export const newInvitationId = (random = randomBytes) => random(9).toString('base64url')

export function mintInvitationToken ({ secret, id, nonce, now = Date.now, ttlSec = INVITE_TTL_SEC }) {
  return signToken(INVITE_KIND, { i: id, n: nonce }, inviteKey(secret), { now, ttlSec })
}

/** `{ ok: true, id, nonce }`, or `{ ok: false, reason: 'malformed' | 'bad-signature' | 'expired' }`. */
export function readInvitationToken (token, { secret, now = Date.now }) {
  const v = verifyToken(INVITE_KIND, token, inviteKey(secret), { now })
  if (!v.ok) return v
  const { i, n } = v.claims
  if (typeof i !== 'string' || typeof n !== 'string' || i === '' || n === '' || i.length > 32 || n.length > 64) return { ok: false, reason: 'malformed' }
  return { ok: true, id: i, nonce: n }
}

/** Can this stored invitation (`{ nonce, exp, accepted_at }`, exp in ms) be used with the token's nonce? `null` when it can, else why not. */
export function invitationFault (row, nonce, now = Date.now) {
  if (row === null || row === undefined) return 'unknown'
  if (row.accepted_at !== null && row.accepted_at !== undefined) return 'used'
  if (row.nonce !== nonce) return 'replaced'
  if (now() >= row.exp) return 'expired'
  return null
}
