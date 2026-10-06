// Read-only relay of the skills.sh index, for every Kybernos user.
//
// skills.sh authenticates its API with the OIDC token of a Vercel project, which only a Vercel deployment receives
// automatically. Kybernos used to ask each user for such a token; this relay holds it once, in the Vercel project
// `kybernos-skills-index`, and serves a cached copy of the public answers.
//
// What it does: four GET routes, each with a closed list of query parameters, forwarded to https://skills.sh/api/v1 with the
// project's own token. What it never does: forward any other path or parameter, follow a caller's URL, return the token,
// store anything, or serve a failure from cache. Pure on purpose: the network and the token are injected, so
// scripts/test-skills-relay.mjs covers it without either.

export const UPSTREAM = 'https://skills.sh/api/v1'
export const VIEWS = ['all-time', 'trending', 'hot']
const MAX_BODY_BYTES = 4 * 1024 * 1024
const UPSTREAM_TIMEOUT_MS = 20000

const SLUG = '[A-Za-z0-9][A-Za-z0-9_.-]{0,99}'

const int = (min, max) => (v) => (/^\d{1,9}$/.test(v) && Number(v) >= min && Number(v) <= max ? String(Number(v)) : null)
const oneOf = (list) => (v) => (list.includes(v) ? v : null)
const text = (min, max) => (v) => (v.length >= min && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v : null)

// One entry per forwarded route. `query` names every parameter the route accepts and how to validate it; `ttl` is how long
// the CDN may serve the answer. Browsing (ranking pages, curated) is the same for everyone: an hour, so each page costs skills.sh
// at most one request an hour however many users there are. Search is different for every word typed: five minutes.
export const ROUTES = [
  { name: 'index', re: /^skills$/, query: { view: oneOf(VIEWS), page: int(0, 100000), per_page: int(1, 500) }, ttl: 3600 },
  { name: 'search', re: /^skills\/search$/, query: { q: text(2, 100), limit: int(1, 100) }, ttl: 300 },
  { name: 'curated', re: /^skills\/curated$/, query: {}, ttl: 3600 },
  { name: 'audit', re: new RegExp('^skills/audit/' + SLUG + '/' + SLUG + '/' + SLUG + '$'), query: {}, ttl: 3600 }
]

const json = (status, payload, cache) => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, 'x-content-type-options': 'nosniff' },
  body: JSON.stringify(payload)
})
const refuse = (status, message, extra) => {
  const out = json(status, { message }, 'no-store')
  return extra === undefined ? out : { ...out, headers: { ...out.headers, ...extra } }
}

/** Pure. The upstream path (no leading slash) the request asks for: the `path` the rewrite adds, else the URL's own path. */
export function requestedPath (url) {
  let u
  try { u = new URL(url, 'http://relay.invalid') } catch (e) { return null }
  const given = u.searchParams.getAll('path')
  if (given.length > 1) return null
  const raw = given.length === 1 ? given[0] : u.pathname.replace(/^\/(?:api\/relay|v1)\/?/, '')
  const path = raw.replace(/^\/+|\/+$/g, '')
  // A path the URL parser would rewrite (dot segments, doubled slashes, a backslash) is not the path we were asked for.
  if (path === '' || /\/\/|\\|(^|\/)\.\.?(\/|$)/.test(path) || path.length > 400) return null
  return path
}

/** Pure. `{ ok, route, path, query }` with a canonical, validated query string, or `{ ok: false, status, message }`. */
export function plan (url) {
  const path = requestedPath(url)
  if (path === null) return { ok: false, status: 400, message: 'bad path' }
  const route = ROUTES.find((r) => r.re.test(path))
  if (route === undefined) return { ok: false, status: 404, message: 'unknown route' }
  let u
  try { u = new URL(url, 'http://relay.invalid') } catch (e) { return { ok: false, status: 400, message: 'bad url' } }
  const seen = new Set()
  const pairs = []
  for (const [k, v] of u.searchParams) {
    if (k === 'path') continue
    if (seen.has(k) || !Object.prototype.hasOwnProperty.call(route.query, k)) return { ok: false, status: 400, message: 'parameter not accepted: ' + k }
    seen.add(k)
    const clean = route.query[k](v)
    if (clean === null) return { ok: false, status: 400, message: 'bad value for ' + k }
    pairs.push([k, clean])
  }
  // Sorted, so the same question always has the same cache key upstream.
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : 1))
  const query = pairs.map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&')
  return { ok: true, route, path, query }
}

const cacheFor = (ttl) => 'public, s-maxage=' + ttl + ', stale-while-revalidate=' + Math.min(ttl * 5, 3600) + ', stale-if-error=3600'

/**
 * `{ status, headers, body }` for one request. `deps.fetch` and `deps.getToken` are injected.
 * Only a good answer is ever cacheable; every refusal and failure is `no-store`.
 */
export async function relay (req, deps) {
  const method = req && typeof req.method === 'string' ? req.method : ''
  if (method !== 'GET' && method !== 'HEAD') return refuse(405, 'GET only', { allow: 'GET, HEAD' })
  const p = plan(req.url)
  if (p.ok !== true) return refuse(p.status, p.message)

  let token = ''
  try { token = await deps.getToken() } catch (e) { token = '' }
  if (typeof token !== 'string' || token === '') return refuse(503, 'index unavailable')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const res = await deps.fetch(UPSTREAM + '/' + p.path + (p.query === '' ? '' : '?' + p.query), {
      method: 'GET',
      signal: controller.signal,
      redirect: 'error',
      headers: { accept: 'application/json', authorization: 'Bearer ' + token, 'user-agent': 'kybernos-skills-index-relay' }
    })
    if (res.status === 404) return json(404, { message: 'not found' }, 'public, s-maxage=60')
    // Our own token or quota being refused is OUR problem: say "unavailable", never what upstream said.
    if (res.status === 429) return refuse(503, 'index busy', { 'retry-after': '30' })
    if (res.status !== 200) return refuse(502, 'index unavailable')
    const raw = await res.text()
    if (raw.length > MAX_BODY_BYTES) return refuse(502, 'index unavailable')
    let parsed
    try { parsed = JSON.parse(raw) } catch (e) { return refuse(502, 'index unavailable') }
    return json(200, parsed, cacheFor(p.route.ttl))
  } catch (e) {
    return refuse(504, 'index unavailable')
  } finally {
    clearTimeout(timer)
  }
}
