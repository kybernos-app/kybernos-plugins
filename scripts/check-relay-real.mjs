#!/usr/bin/env node
// Smoke test of the Team relay against the REAL host (127.0.0.1:3080 by default) and the deployed API. READ-ONLY.
//
//   node scripts/check-relay-real.mjs
//
// It calls the host route /kybernos-cloud/relay the way the page does (same-origin GETs, with the user's own session held by
// the host) and the open /kybernos-cloud/server route. It prints counts and statuses, never an id, a name or a token.
// Exit 0 all green, 1 a check failed, 3 inconclusive (host down, not signed in).
//
// What it proves that the unit tests cannot: the host that is RUNNING has the route (a restart happened after the merge), the
// deployed API has the relay (a 503 « not configured » or a 200, not a 404), and an outside caller is refused.
const AUTHORITY = process.env.KB_HOST || '127.0.0.1:3080'
const BASE = 'http://' + AUTHORITY
let pass = 0; let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 200))) } }
const relay = async (path, headers = { origin: BASE }) => {
  const r = await fetch(BASE + '/kybernos-cloud/relay?p=' + encodeURIComponent(path), { headers })
  let body = null
  try { body = await r.json() } catch (e) { body = null }
  return { http: r.status, body }
}

let status = null
try { status = await (await fetch(BASE + '/kybernos-cloud/status')).json() } catch (e) { console.error('○ inconclusive: the host does not answer at ' + BASE); process.exit(3) }
if (status === null || status.connected !== true) { console.error('○ inconclusive: this DSH is not signed in to Kybernos Cloud'); process.exit(3) }

console.log('the open route of the active server')
{
  const s = await (await fetch(BASE + '/kybernos-cloud/server')).json()
  check('GET /kybernos-cloud/server answers with the active server and its address', s.ok === true && typeof s.server.id === 'string' && /^https?:\/\//.test(s.server.api), Object.keys(s))
  check('every listed server says whether it is signed in', Array.isArray(s.servers) && s.servers.length >= 1 && s.servers.every((x) => typeof x.connected === 'boolean' && typeof x.api === 'string'))
  check('the active one is listed once', s.servers.filter((x) => x.active).length === 1)
  check('no token travels in it', JSON.stringify(s).indexOf('kys-') < 0)
}

console.log('the relay, read-only')
const ws = await relay('/v1/workspaces')
check('the relay route exists in the running host and the API answers: /v1/workspaces', ws.http === 200 && ws.body !== null && ws.body.ok === true && ws.body.status === 200, ws)
const list = ws.body && ws.body.body && Array.isArray(ws.body.body.workspaces) ? ws.body.body.workspaces : []
check('the account has at least one workspace', list.length >= 1)
if (list.length > 0) {
  const id = list[0].id
  const me = await relay('/v1/me')
  check('/v1/me answers, without any token in the body', me.body.ok === true && JSON.stringify(me.body).indexOf('kys-') < 0)
  const members = await relay('/v1/workspaces/' + id + '/members')
  const rows = members.body && members.body.body ? members.body.body.members : null
  check('members: user id, role, status, created_at (the main API holds no name or email)', Array.isArray(rows) && rows.length >= 1 && rows.every((r) => typeof r.user_id === 'string' && typeof r.role === 'string') && rows.every((r) => !('email' in r) && !('name' in r)), rows && Object.keys(rows[0] || {}))
  for (const route of ['budget', 'usage', 'models', 'catalog']) {
    const r = await relay('/v1/workspaces/' + id + '/llm/' + route)
    const known = r.http === 200 && r.body !== null && ((r.body.ok === true && r.body.status === 200) || (r.body.status === 503 && /not configured/.test(JSON.stringify(r.body.body))) || r.body.status === 502)
    check('llm/' + route + ': the deployed API has the relay (200, or 503 « not configured », or 502 upstream), never 404', known, r.body && { status: r.body.status, body: r.body.body })
  }
  const billing = await relay('/v1/workspaces/' + id + '/llm/billing')
  check('llm/billing: same, or 403 when the caller is not an admin', billing.body !== null && [200, 403, 502, 503].includes(billing.body.status), billing.body && billing.body.status)
  const other = await relay('/v1/workspaces/00000000-0000-4000-8000-000000000000/members')
  check('a workspace that is not this account\'s is refused by the host before any call', other.body.ok === false && other.body.error === 'espace_inconnu', other.body)
}

console.log('who may ask, and what')
{
  const none = await relay('/v1/workspaces', {})
  check('a caller that names no origin is refused (403)', none.http === 403, none.http)
  const foreign = await relay('/v1/workspaces', { origin: 'https://evil.example' })
  check('a caller from another origin is refused (403)', foreign.http === 403, foreign.http)
  const keys = await relay('/v1/keys')
  check('a path off the allowlist is refused, with no call', keys.body.ok === false && keys.body.error === 'chemin refuse', keys.body)
  const traversal = await relay('/v1/workspaces/' + (list[0] ? list[0].id : '00000000-0000-4000-8000-000000000000') + '/llm/../members')
  check('a dot-segment path is refused', traversal.body.ok === false)
  const post = await fetch(BASE + '/kybernos-cloud/relay?p=' + encodeURIComponent('/v1/me'), { method: 'POST', headers: { origin: BASE } })
  check('the route is GET only', post.status === 405, post.status)
}

console.log('\n' + (fail === 0 ? 'all ' + pass + ' checks passed' : fail + ' check(s) failed, ' + pass + ' passed'))
process.exit(fail === 0 ? 0 : 1)
