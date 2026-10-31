// bearer.mjs — what a request's `Authorization: Bearer` header means to a team space. Pure: the clock is injected.
//
// The owner's computer acts as the owner with a token it mints for each request (kybernos-db remote/token.mjs). This is the rule that decides what such a header does:
//
//   no bearer header                    → `none`: the request is whatever its cookies say
//   a bearer that does not verify       → `refused` 401, whether or not cookies came along: a bad token never falls back to a session
//   a good bearer and any cookie        → `cookie`: the request is treated as cookie-authenticated (Origin and CSRF apply, the session says who it is); the bearer is ignored
//   a good bearer, no cookie            → `bearer` (the owner), on the apps routes and nowhere else; on another route `refused` 403
//
// A browser that sends cookies on its own cannot be made to add a header on another site's behalf without a CORS preflight this app never answers; a client that sends no
// cookies has nothing for a forged request to ride on. That is why `bearer` skips Origin and CSRF, and why a request with both does not.
import { bearerOf, verifyOwnerApiToken } from './db.mjs'

/** What a bearer request may reach: the apps routes, who it is, and the health check. */
export const BEARER_SCOPE = /^\/(?:api\/(?:apps(?:\/|$)|me$)|health$)/

/** `{ who: 'none' | 'cookie' | 'bearer' }`, or `{ who: 'refused', status, error, reason? }`. `authorization` and `cookie` are the header values (or undefined). */
export function judgeBearer ({ authorization, cookie, path, key, now = Date.now }) {
  const token = bearerOf(authorization)
  if (token === null) return { who: 'none' }
  const v = verifyOwnerApiToken(token, key, { now })
  if (!v.ok) return { who: 'refused', status: 401, error: 'unauthenticated', reason: v.reason }
  if (typeof cookie === 'string' && cookie !== '') return { who: 'cookie' }
  if (!BEARER_SCOPE.test(path)) return { who: 'refused', status: 403, error: 'forbidden', reason: 'bearer-scope' }
  return { who: 'bearer' }
}
