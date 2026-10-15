// Tests of the relay route the Team settings console uses through its parent page (/kybernos-cloud/relay).
//   node packages/kybernos-cloud/test-relay.mjs
//
// The console is a page of another origin in an iframe: it never holds a session token. This route is the only thing that
// does. What matters: it answers only what the allowlist names (GET, a workspace of THIS account, date-only query), it
// refuses a caller that names no origin of this server, and the token goes out in an Authorization header and nowhere else.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

const W1 = '11111111-1111-4111-8111-111111111111'
const W2 = '22222222-2222-4222-8222-222222222222'
const WX = '99999999-9999-4999-8999-999999999999'
const TOKEN = 'kys-secret-token-0123456789'

// A stand-in for the main API: records what it receives.
const seen = []
const api = createServer((req, res) => {
  seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, headers: req.headers })
  res.writeHead(req.url.startsWith('/v1/workspaces/' + W1 + '/llm/budget') ? 200 : (req.url === '/v1/me' ? 200 : 403), { 'content-type': 'application/json' })
  res.end(JSON.stringify(req.url === '/v1/me' ? { id: 'u-1', name: null, plan: 'studio' } : (req.url.includes('/budget') ? { plan: { pack: 'full' }, shared_remaining: 12.5, members: [] } : { error: 'forbidden here' })))
})
await new Promise((r) => api.listen(0, '127.0.0.1', r))
const dir = mkdtempSync(join(tmpdir(), 'kb-relay-'))
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + api.address().port
process.env.KYBERNOS_CLOUD_STATE = join(dir, 'state.json')
const writeState = (state) => writeFileSync(process.env.KYBERNOS_CLOUD_STATE, JSON.stringify(state))
const connected = { token: TOKEN, user: { email: 'a@b.test' }, workspaces: [{ id: W1, name: 'Acme' }, { id: W2, name: 'Other' }], active_workspace_id: W1 }

const mod = await import('./index.js')
const { relayCheck, sameOriginStrict, relayRules } = mod
const route = mod.ROUTES.find((r) => r.path === '/kybernos-cloud/relay')

console.log('what the allowlist names')
{
  for (const ok of ['/v1/me', '/v1/sessions', '/v1/referral', '/v1/me/mfa', '/v1/public/legal', '/v1/workspaces', '/v1/workspaces/' + W1 + '/members', '/v1/workspaces/' + W1 + '/providers', '/v1/workspaces/' + W1 + '/models',
    '/v1/workspaces/' + W1 + '/llm/budget', '/v1/workspaces/' + W2 + '/llm/catalog', '/v1/workspaces/' + W1 + '/llm/billing', '/v1/workspaces/' + W1 + '/llm/usage',
    '/v1/workspaces/' + W1 + '/llm/usage?from=2026-09-01&to=2026-09-25', '/v1/workspaces/' + W1.toUpperCase() + '/llm/models',
    // The team's metadata the frame's pages draw (Members, Models, Billing, Team security, Computers).
    '/v1/workspaces/' + W1 + '/invitations', '/v1/workspaces/' + W1 + '/security', '/v1/workspaces/' + W1 + '/computers', '/v1/workspaces/' + W1 + '/computers/usage',
    '/v1/workspaces/' + W1 + '/llm/member-limits', '/v1/workspaces/' + W1 + '/llm/byok', '/v1/workspaces/' + W1 + '/llm/byok/credentials',
    '/v1/workspaces/' + W1 + '/llm/byok/models', '/v1/workspaces/' + W1 + '/llm/provider-policy', '/v1/workspaces/' + W1 + '/llm/provider-acceptances',
    '/v1/workspaces/' + W2.toUpperCase() + '/invitations',
    // The two most personal ones (each behind its own switch): the person's API keys and the team's trail.
    '/v1/keys', '/v1/keys?limit=200', '/v1/keys?limit=200&workspace_id=' + W1, '/v1/keys?workspace_id=' + W2.toUpperCase(),
    '/v1/workspaces/' + W1 + '/audit', '/v1/workspaces/' + W1 + '/audit?limit=50', '/v1/workspaces/' + W1 + '/audit?limit=100&before=' + WX]) {
    check('allowed: ' + ok.replace(W1, 'W1').replace(W2, 'W2'), relayCheck(ok, connected).ok === true, JSON.stringify(relayCheck(ok, connected)))
  }
  const canonical = relayCheck('/v1/workspaces/' + W1 + '/llm/usage?to=2026-09-25T00:00:00Z&from=2026-09-01', connected)
  const grouped = relayCheck('/v1/workspaces/' + W1 + '/llm/usage?group_by=detail&from=2026-09-01&to=2026-09-25', connected)
  check('a usage query may ask for the per-day, per-member detail', grouped.ok === true && grouped.path === '/v1/workspaces/' + W1 + '/llm/usage?group_by=detail&from=2026-09-01&to=2026-09-25', JSON.stringify(grouped))
  for (const g of ['model', 'day', 'member', 'detail']) check('group_by=' + g + ' is allowed', relayCheck('/v1/workspaces/' + W1 + '/llm/usage?group_by=' + g, connected).ok === true)
  check('a usage query keeps only from and to, URL-encoded', canonical.ok === true && canonical.path === '/v1/workspaces/' + W1 + '/llm/usage?to=2026-09-25T00%3A00%3A00Z&from=2026-09-01', JSON.stringify(canonical))
}

console.log('what it refuses')
{
  const no = (label, target, why) => {
    const r = relayCheck(target, connected)
    check('refused: ' + label, r.ok === false, JSON.stringify(r))
    if (why !== undefined) check('  … as ' + why, r.error === why, r.error)
  }
  no('another API route (the admin\'s)', '/v1/admin/whoami')
  no('the sessions with a query', '/v1/sessions?limit=9')
  no('a sub-path of the sessions (revoking one is a write)', '/v1/sessions/abc')
  no('a sub-path of the referral', '/v1/referral/claim')
  no('the second factor with a query', '/v1/me/mfa?x=1')
  no('a sub-path of the second factor (enrolling or removing one is a write)', '/v1/me/mfa/setup')
  no('another sub-path of the second factor', '/v1/me/mfa/verify')
  no('the legal page with a query', '/v1/public/legal?lang=fr')
  no('a sub-path of the legal page', '/v1/public/legal/terms')
  no('another public route', '/v1/public/plans')
  no('the public prefix alone', '/v1/public')
  no('the second factor with a trailing slash', '/v1/me/mfa/')
  // The team's metadata reads: exact paths, a team of this account, no query, no sub-path, no trailing slash.
  for (const name of ['invitations', 'security', 'computers', 'computers/usage', 'llm/member-limits', 'llm/byok', 'llm/byok/credentials', 'llm/byok/models', 'llm/provider-policy', 'llm/provider-acceptances']) {
    const base = '/v1/workspaces/' + W1 + '/' + name
    no(name + ' with a query', base + '?limit=5')
    no(name + ' with a suffix', base + '/x')
    no(name + ' with a trailing slash', base + '/')
    no(name + ' of a team that is not the account\'s', '/v1/workspaces/' + WX + '/' + name, 'espace_inconnu')
    no(name + ' of an id that is not a uuid', '/v1/workspaces/not-a-uuid/' + name)
  }
  no('one computer (its detail is not named)', '/v1/workspaces/' + W1 + '/computers/' + WX)
  no('the computers policy', '/v1/workspaces/' + W1 + '/computers/policy')
  no('a credential by id (the detail and every write are not named)', '/v1/workspaces/' + W1 + '/llm/byok/credentials/' + WX)
  no('a model by id', '/v1/workspaces/' + W1 + '/llm/byok/models/' + WX)
  no('one invitation', '/v1/workspaces/' + W1 + '/invitations/' + WX)
  no('the trail\'s export (a file, another route)', '/v1/workspaces/' + W1 + '/audit/export')
  no('the trail with a key the server does not take', '/v1/workspaces/' + W1 + '/audit?limit=50&actor=u-1')
  no('the trail with a zero limit', '/v1/workspaces/' + W1 + '/audit?limit=0')
  no('the trail with a limit over the server\'s 100', '/v1/workspaces/' + W1 + '/audit?limit=101')
  no('the trail with a limit that is not a plain integer', '/v1/workspaces/' + W1 + '/audit?limit=5e1')
  no('the trail with a signed limit', '/v1/workspaces/' + W1 + '/audit?limit=-5')
  no('the trail with a leading zero limit', '/v1/workspaces/' + W1 + '/audit?limit=050')
  no('the trail with an empty limit', '/v1/workspaces/' + W1 + '/audit?limit=')
  no('the trail with a cursor that is not a uuid', '/v1/workspaces/' + W1 + '/audit?before=abc')
  no('the trail with a repeated cursor', '/v1/workspaces/' + W1 + '/audit?before=' + WX + '&before=' + WX)
  no('the trail of a team that is not the account\'s', '/v1/workspaces/' + WX + '/audit?limit=50', 'espace_inconnu')
  no('the trail with a date (it takes none)', '/v1/workspaces/' + W1 + '/audit?from=2026-09-01')
  no('the keys with a cursor (no pagination)', '/v1/keys?before=' + WX)
  no('the keys with a limit over the server\'s 200', '/v1/keys?limit=201')
  no('the keys with a zero limit', '/v1/keys?limit=0')
  no('the keys with a key the server does not take', '/v1/keys?limit=10&user_id=u-1')
  no('the keys of a workspace that is not a uuid', '/v1/keys?workspace_id=not-a-uuid')
  no('the keys of a workspace that is not the account\'s', '/v1/keys?workspace_id=' + WX, 'espace_inconnu')
  no('the keys with a repeated workspace', '/v1/keys?workspace_id=' + W1 + '&workspace_id=' + W2)
  no('a key by id (revoking one is a write)', '/v1/keys/' + WX)
  no('the keys with a trailing slash', '/v1/keys/')
  no('the account\'s Telegram link', '/v1/me/telegram')
  no('device pairing', '/v1/device/start')
  no('the LLM keys', '/v1/workspaces/' + W1 + '/llm/keys')
  no('a member sub-path', '/v1/workspaces/' + W1 + '/llm/members/u-1')
  no('lessons', '/v1/workspaces/' + W1 + '/lessons')
  no('dot segments', '/v1/workspaces/' + W1 + '/llm/../members')
  no('an encoded traversal', '/v1/workspaces/' + W1 + '/llm/%2e%2e/members')
  no('a protocol-relative URL', '//evil.example/v1/me')
  no('an absolute URL', 'https://evil.example/v1/me')
  no('a query on a route that takes none', '/v1/workspaces/' + W1 + '/members?limit=9')
  no('a foreign parameter on usage', '/v1/workspaces/' + W1 + '/llm/usage?user_ref=u-2')
  no('a non-date value', '/v1/workspaces/' + W1 + '/llm/usage?from=drop%20table')
  no('a grouping the server does not have', '/v1/workspaces/' + W1 + '/llm/usage?group_by=members')
  no('a grouping that is a date', '/v1/workspaces/' + W1 + '/llm/usage?group_by=2026-09-01')
  no('a repeated grouping', '/v1/workspaces/' + W1 + '/llm/usage?group_by=day&group_by=detail')
  no('a grouping on a route that has none', '/v1/workspaces/' + W1 + '/llm/budget?group_by=day')
  no('a repeated parameter', '/v1/workspaces/' + W1 + '/llm/usage?from=2026-09-01&from=2026-09-02')
  no('an empty target', '')
  no('a target of the wrong type', null)
  no('a very long target', '/v1/workspaces/' + W1 + '/llm/usage?from=' + '2'.repeat(400))
  no('a workspace that is not one of the account\'s', '/v1/workspaces/' + WX + '/llm/budget', 'espace_inconnu')
  no('a workspace id that is not a uuid', '/v1/workspaces/not-a-uuid/members')
}

console.log('the two personal reads are behind their own switches')
{
  const off = relayRules({ apiKeysList: false, auditTrail: false })
  const keysOnly = relayRules({ apiKeysList: true, auditTrail: false })
  const trailOnly = relayRules({ apiKeysList: false, auditTrail: true })
  const verdict = (target, rules) => relayCheck(target, connected, rules).ok === true
  const KEYS = '/v1/keys?limit=200&workspace_id=' + W1
  const TRAIL = '/v1/workspaces/' + W1 + '/audit?limit=50'
  check('both switches are on in the shipped list', verdict(KEYS, mod.RELAY_RULES) && verdict(TRAIL, mod.RELAY_RULES))
  check('both off: neither path is reachable, and the rest of the list is the same', !verdict(KEYS, off) && !verdict(TRAIL, off) && verdict('/v1/me', off) && verdict('/v1/workspaces/' + W1 + '/invitations', off) && verdict('/v1/workspaces/' + W1 + '/llm/usage?group_by=detail', off))
  check('the keys list alone: reachable, and the trail is not', verdict(KEYS, keysOnly) && !verdict(TRAIL, keysOnly))
  check('the trail alone: reachable, and the keys are not', verdict(TRAIL, trailOnly) && !verdict(KEYS, trailOnly))
  check('with no options at all (a call with nothing set) neither is named: withheld is the default of the builder', !verdict(KEYS, relayRules()) && !verdict(TRAIL, relayRules()))
  const host = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.js'), 'utf8')
  check('the two switches are named constants a host can set to false in one line', /^const RELAY_ALLOW_API_KEYS_LIST = true$/m.test(host) && /^const RELAY_ALLOW_TEAM_AUDIT_TRAIL = true$/m.test(host))
  check('and the shipped list is built from exactly those two', /const RELAY_RULES = relayRules\(\{ apiKeysList: RELAY_ALLOW_API_KEYS_LIST, auditTrail: RELAY_ALLOW_TEAM_AUDIT_TRAIL \}\)/.test(host))
}

console.log('who may ask (strict origin)')
{
  const req = (headers, port = 3080) => ({ headers, socket: { localPort: port } })
  check('no Origin and no Referer: refused (a local process can omit them)', sameOriginStrict(req({})) === false)
  check('Origin of this server: allowed', sameOriginStrict(req({ origin: 'http://127.0.0.1:3080' })) === true)
  check('Referer of this server (a same-origin GET sends only that): allowed', sameOriginStrict(req({ referer: 'http://localhost:3080/#x' })) === true)
  check('the IPv6 loopback: allowed', sameOriginStrict(req({ origin: 'http://[::1]:3080' })) === true)
  check('another origin: refused', sameOriginStrict(req({ origin: 'https://evil.example' })) === false)
  check('the console\'s own origin: refused (it asks its parent, never this route)', sameOriginStrict(req({ origin: 'https://dev.kybernos.app' })) === false)
  check('another port of the same host: refused', sameOriginStrict(req({ origin: 'http://127.0.0.1:3081' })) === false)
  check('« null » and file: origins: refused', sameOriginStrict(req({ origin: 'null' })) === false && sameOriginStrict(req({ origin: 'file:///x' })) === false)
  check('a forged Host header does not help', sameOriginStrict(req({ origin: 'http://evil.example', host: 'evil.example' })) === false)
  check('a request object without headers is refused, not a crash', sameOriginStrict({}) === false && sameOriginStrict(null) === false)
}

console.log('the route')
{
  check('it is a strict, guarded GET', route !== undefined && route.method === 'GET' && route.guarded === true && route.strict === true)
  writeState({})
  check('not connected: nothing is called', (await route.run({ url: '/kybernos-cloud/relay?p=' + encodeURIComponent('/v1/me') })).connected === false && seen.length === 0)
  writeState(connected)
  const out = await route.run({ url: '/kybernos-cloud/relay?p=' + encodeURIComponent('/v1/workspaces/' + W1 + '/llm/budget') })
  check('an allowed path is called on the main API, GET, with the token as Authorization', out.ok === true && out.status === 200 && seen.length === 1 && seen[0].method === 'GET' && seen[0].auth === 'Bearer ' + TOKEN, JSON.stringify(seen))
  check('the answer is { ok, status, body } and the token is nowhere in it', JSON.stringify(out).indexOf(TOKEN) < 0 && out.body.shared_remaining === 12.5)
  check('the page\'s own headers never reach the API', seen[0].headers.cookie === undefined && seen[0].headers.origin === undefined)
  const forbidden = await route.run({ url: '/kybernos-cloud/relay?p=' + encodeURIComponent('/v1/workspaces/' + W2 + '/members') })
  check('a status the server refuses comes back as it is (ok:false, 403), not as a success', forbidden.ok === false && forbidden.status === 403)
  const before = seen.length
  const refused = await route.run({ url: '/kybernos-cloud/relay?p=' + encodeURIComponent('/v1/admin/whoami') })
  check('a path off the allowlist is refused with no call at all', refused.ok === false && refused.error === 'chemin refuse' && seen.length === before)
  check('no p parameter: refused with no call', (await route.run({ url: '/kybernos-cloud/relay' })).ok === false && seen.length === before)
  // The two paths the embedded Security and Support & legal pages read: called on the main API as plain GETs, with the token as Authorization.
  for (const p of ['/v1/me/mfa', '/v1/public/legal']) {
    const n = seen.length
    const r = await route.run({ url: '/kybernos-cloud/relay?p=' + encodeURIComponent(p) })
    check(p + ' is called on the main API: GET, token in Authorization, nothing else', r.ok !== undefined && r.error !== 'chemin refuse' && seen.length === n + 1 && seen[n].method === 'GET' && seen[n].url === p && seen[n].auth === 'Bearer ' + TOKEN, JSON.stringify(seen.slice(n)))
    check('  … and the token is nowhere in the answer', JSON.stringify(r).indexOf(TOKEN) < 0)
  }
}

console.log('the wiring (drift tests)')
{
  const here = dirname(fileURLToPath(import.meta.url))
  const host = readFileSync(join(here, 'index.js'), 'utf8')
  check('the dispatcher applies the strict guard to strict routes', host.indexOf('route.strict === true && sameOriginStrict(req) === false') > 0)
  check('every relay rule is an exact GET-only read: none names a write or an export', RELAY_NO_WRITE(mod.RELAY_RULES) && RELAY_NO_WRITE(relayRules({ apiKeysList: true, auditTrail: true })))
}

function RELAY_NO_WRITE (rules) {
  // Every rule is an exact read path: none names a verb of a write (a key's secret, an invitation to send, a removal, a checkout, a rotation, a ticket, a hook, a
  // second-factor setup) or a path continued after the name it ends on. The keys and invitations are LISTS here (their writes are other methods and other paths).
  return rules.every((r) => r.re.source.endsWith('$') && !/remove|checkout|subscribe|rotate|ticket|hooks|setup|verify|revoke|export|mint|create|policy\/|start|stop|pause|resume/.test(r.re.source))
}

api.close()
rmSync(dir, { recursive: true, force: true })
console.log('\n' + (failed === 0 ? 'all checks OK' : failed + ' check(s) failed'))
process.exit(failed === 0 ? 0 : 1)
