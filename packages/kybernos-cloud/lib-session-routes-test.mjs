// Test helper (not a test: the name does not start with "test"). The write routes of this bundle that need DSH's signed session cookie besides the right Origin, and the
// way the person's browser calls them. A test that calls one of them by hand dresses its request with `asBrowser` (the machine secret is given to the guard here).
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, browserHeaders } from './lib-session-test.mjs'

sessionSource.secret = () => SESSION_SECRET

/** The routes of the personal memory and of the space that a bare curl must not reach (the delete routes are covered by test-cloud-host.mjs). */
export const SESSION_WRITE_PATHS = new Set(['/kybernos-cloud/space/active', '/kybernos-cloud/memory/add', '/kybernos-cloud/memory/update', '/kybernos-cloud/memory/lessons', '/kybernos-cloud/team/lessons/add', '/kybernos-cloud/kyby/native/set'])

/** `req` as the person's own browser sends it to `path`: the page's Origin and DSH's session cookie, on a socket of DSH's port. Other paths are returned as they are. */
export const asBrowser = (path, req) => {
  if (!SESSION_WRITE_PATHS.has(String(path).split('?')[0])) return req
  return { ...req, socket: req.socket !== undefined ? req.socket : { localPort: 3080, remoteAddress: '127.0.0.1' }, headers: { ...req.headers, cookie: browserHeaders().cookie, origin: req.headers.origin !== undefined ? req.headers.origin : browserHeaders().origin } }
}
