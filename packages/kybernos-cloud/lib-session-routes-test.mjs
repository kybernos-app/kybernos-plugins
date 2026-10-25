// Test helper (not a test: the name does not start with "test"). The write routes of this bundle that need DSH's signed session cookie
// besides the right Origin, and the way the person's browser calls them. A test that calls one of them by hand dresses its request with
// `asBrowser` (the machine secret is given to the guard here).
//
// A-16 (audit 2026-10-20) put every cloud write a page drives under the origin rule of docs/dev/route-origin-rule.md; L3-04 and L3-05 (recette
// 2026-10-25) found fifteen that had stayed at the Origin alone (the Account page's instructions, the Telegram and WhatsApp pairing, the console
// link, the payment pages, the Home computer's actions). This list is now the whole POST surface of the bundle except the routes whose caller is
// not only a browser: STRICT_ONLY_EXCEPTIONS names them with the caller, and ROUTES carries the same words as `noSession`.
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
  '/kybernos-cloud/team/automations/add', '/kybernos-cloud/team/automations/check', '/kybernos-cloud/team/automations/delete', '/kybernos-cloud/team/automations/retire', '/kybernos-cloud/team/automations/review',
  // The Automations page's two writes to the person's cloud computers (they were under the rule already, and missing here).
  '/kybernos-cloud/computers/publish', '/kybernos-cloud/computers/approvals/decide',
  // L3-04 / L3-05: the fifteen that were at the Origin alone.
  '/kybernos-cloud/instructions/save', '/kybernos-cloud/telegram/pairing', '/kybernos-cloud/telegram/pairing/cancel', '/kybernos-cloud/telegram/unlink',
  '/kybernos-cloud/whatsapp/pairing', '/kybernos-cloud/whatsapp/pairing/cancel', '/kybernos-cloud/whatsapp/unlink', '/kybernos-cloud/kyby/computer',
  '/kybernos-cloud/computer/open', '/kybernos-cloud/computer/resume', '/kybernos-cloud/computer/suspend', '/kybernos-cloud/console/link',
  '/kybernos-cloud/billing/checkout', '/kybernos-cloud/billing/portal', '/kybernos-cloud/invitation/preview',
])

/** The write routes that need a strict same-origin request but not the cookie, because a caller that is not a browser reaches them too, and that a test
 *  dresses with the page's Origin (`asBrowser`). The turn routes and `computer/claimed` are in STRICT_ONLY_EXCEPTIONS only: their tests send their own headers. */
export const STRICT_WRITE_PATHS = new Set(['/kybernos-cloud/server/apply'])

/** Every POST route that may stay at the strict Origin alone, with the caller that makes it so. ROUTES marks the same paths `noSession` and writes the
 *  reason; test-write-guard.mjs checks that the two lists are the same, so a route cannot be left out of the cookie rule, or put back to the Origin
 *  alone, without a reason written down in both places. */
export const STRICT_ONLY_EXCEPTIONS = new Map([
  ['/kybernos-cloud/server/apply', 'kybernos-servers host'],
  ['/kybernos-cloud/turn', "computer's own runner"],
  ['/kybernos-cloud/turn/answer', "computer's own runner"],
  ['/kybernos-cloud/turn/continue', "computer's own runner"],
  ['/kybernos-cloud/computer/claimed', 'computer image claimer'],
])

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
