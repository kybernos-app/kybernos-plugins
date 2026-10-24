// Test helper (not a test: the name does not start with "test"). The write routes of this bundle that need DSH's signed session cookie
// besides the right Origin, and the way the person's browser calls them. A test that calls one of them by hand dresses its request with
// `asBrowser` (the machine secret is given to the guard here).
//
// A-16 (audit 2026-10-20): every cloud write a page drives is now under the origin rule of docs/dev/route-origin-rule.md, so this list is
// the whole POST surface of the bundle except the two whose caller is not only a browser: `/kybernos-cloud/turn*` (the computer's own
// runner) and `/kybernos-cloud/server/apply` (kybernos-servers' host makes a loopback call with an Origin and no cookie, so it is strict,
// not cookie: see STRICT_WRITE_PATHS).
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

sessionSource.secret = () => SESSION_SECRET

/** Every POST route of the bundle that needs the signed session cookie (`session: true` in ROUTES). */
export const SESSION_WRITE_PATHS = new Set([
  '/kybernos-cloud/artifacts/detail', '/kybernos-cloud/artifacts/push', '/kybernos-cloud/chat/ensure', '/kybernos-cloud/chats/push',
  '/kybernos-cloud/connections/delete', '/kybernos-cloud/connections/link', '/kybernos-cloud/disconnect', '/kybernos-cloud/invitation/accept',
  '/kybernos-cloud/kyby/native/set', '/kybernos-cloud/marketplace/install', '/kybernos-cloud/members/invite', '/kybernos-cloud/members/remove',
  '/kybernos-cloud/memory/add', '/kybernos-cloud/memory/delete', '/kybernos-cloud/memory/index/run',
  '/kybernos-cloud/memory/settings/set', '/kybernos-cloud/memory/tidy/apply', '/kybernos-cloud/memory/tidy/dismiss',
  '/kybernos-cloud/memory/tidy/scan', '/kybernos-cloud/memory/tidy/settings', '/kybernos-cloud/memory/tidy/undo', '/kybernos-cloud/memory/update',
  '/kybernos-cloud/models/sync', '/kybernos-cloud/poll', '/kybernos-cloud/refresh', '/kybernos-cloud/shares/revoke', '/kybernos-cloud/shares/set',
  '/kybernos-cloud/space/active', '/kybernos-cloud/space/applied', '/kybernos-cloud/space/create', '/kybernos-cloud/space/folder',
  '/kybernos-cloud/space/for-folder', '/kybernos-cloud/start', '/kybernos-cloud/team/lessons/add', '/kybernos-cloud/team/lessons/delete',
  '/kybernos-cloud/team/lessons/retire', '/kybernos-cloud/team/lessons/review', '/kybernos-cloud/team/skills/add', '/kybernos-cloud/team/skills/delete',
  '/kybernos-cloud/team/skills/retire', '/kybernos-cloud/team/skills/review',
])

/** The write routes that need a strict same-origin request but not the cookie, because a caller that is not a browser reaches them too. */
export const STRICT_WRITE_PATHS = new Set(['/kybernos-cloud/server/apply'])

/** `req` as the person's own browser sends it to `path`: the page's Origin and (under the rule) DSH's session cookie. The cookie is signed for
 *  the authority the request reports on its socket (a test that moves the listener's port gets a cookie for that port, as DSH does). */
export const asBrowser = (path, req) => {
  const p = String(path).split('?')[0]
  const session = SESSION_WRITE_PATHS.has(p)
  if (session !== true && STRICT_WRITE_PATHS.has(p) !== true) return req
  const socket = req.socket !== undefined ? req.socket : { localPort: 3080, remoteAddress: '127.0.0.1' }
  const authority = '127.0.0.1:' + (typeof socket.localPort === 'number' ? socket.localPort : 3080)
  return {
    ...req,
    socket,
    headers: {
      ...req.headers,
      origin: req.headers.origin !== undefined ? req.headers.origin : 'http://' + authority,
      ...(session === true ? { cookie: sessionCookie(authority) } : {}),
    },
  }
}
