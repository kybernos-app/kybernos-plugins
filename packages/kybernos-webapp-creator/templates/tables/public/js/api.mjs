// api.mjs — the page's calls to its own server. Everything that changes something carries the CSRF token the server gave this browser (GET /api/csrf); when the server says the
// token is stale (the cookie was renewed), one fresh token is fetched and the call is sent once more. Every call answers `{ ok, status, body }` and never throws: a server that
// cannot be reached is `status: 0`.
export function makeApi (fetchFn = (...a) => fetch(...a)) {
  let token = null

  async function send (method, url, { json, bytes, type } = {}) {
    const headers = {}
    let body
    if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json) }
    if (bytes !== undefined) { headers['content-type'] = type || 'application/octet-stream'; body = bytes }
    if (method !== 'GET') {
      if (token === null) token = await fresh()
      if (token !== null) headers['x-csrf-token'] = token
    }
    let res
    try { res = await fetchFn(url, { method, headers, body, credentials: 'same-origin', cache: 'no-store' }) } catch (e) { return { ok: false, status: 0, body: null } }
    let data = null
    try { data = await res.json() } catch (e) { /* not json: no body */ }
    return { ok: res.ok && !(data !== null && typeof data === 'object' && data.ok === false), status: res.status, body: data }
  }

  async function fresh () {
    try {
      const res = await fetchFn('/api/csrf', { credentials: 'same-origin', cache: 'no-store' })
      const data = await res.json()
      return res.ok && typeof data.token === 'string' ? data.token : null
    } catch (e) { return null }
  }

  /** The same call, once more with a new token, when the first was refused for the token. */
  async function call (method, url, opts) {
    const first = await send(method, url, opts)
    if (first.status === 403 && first.body !== null && first.body.error === 'bad-csrf') { token = await fresh(); return send(method, url, opts) }
    return first
  }

  const app = (slug) => '/api/apps/' + encodeURIComponent(slug)
  const query = (o) => Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&')

  return {
    /** Who is signed in, or a null body when nobody is (a 200, so an anonymous visit leaves no error in the console). */
    session: () => call('GET', '/api/auth/get-session'),
    me: () => call('GET', '/api/me'),
    apps: () => call('GET', '/api/apps'),
    people: () => call('GET', '/api/people'),
    records: (slug, object) => call('GET', app(slug) + '/records?' + query({ object })),
    links: (slug, object, id) => call('GET', app(slug) + '/links?' + query({ object, id })),
    write: (slug, payload) => call('POST', app(slug) + '/write', { json: payload }),
    upload: (slug, object, field, file) => call('POST', app(slug) + '/upload?' + query({ object, field, name: file.name }), { bytes: file, type: file.type }),
    fileUrl: (slug, object, id, field, hash) => app(slug) + '/file?' + query({ object, id, field, hash }),
    signIn: (email, password) => call('POST', '/api/auth/sign-in/email', { json: { email, password } }),
    signOut: () => call('POST', '/api/auth/sign-out', { json: {} }),
    setPassword: (password) => call('POST', '/api/me/password', { json: { password } }),
  }
}
