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
const { relayCheck, sameOriginStrict } = mod
const route = mod.ROUTES.find((r) => r.path === '/kybernos-cloud/relay')

console.log('what the allowlist names')
{
  for (const ok of ['/v1/me', '/v1/workspaces', '/v1/workspaces/' + W1 + '/members', '/v1/workspaces/' + W1 + '/providers', '/v1/workspaces/' + W1 + '/models',
    '/v1/workspaces/' + W1 + '/llm/budget', '/v1/workspaces/' + W2 + '/llm/catalog', '/v1/workspaces/' + W1 + '/llm/billing', '/v1/workspaces/' + W1 + '/llm/usage',
    '/v1/workspaces/' + W1 + '/llm/usage?from=2026-09-01&to=2026-09-25', '/v1/workspaces/' + W1.toUpperCase() + '/llm/models']) {
    check('allowed: ' + ok.replace(W1, 'W1').replace(W2, 'W2'), relayCheck(ok, connected).ok === true, JSON.stringify(relayCheck(ok, connected)))
  }
  const canonical = relayCheck('/v1/workspaces/' + W1 + '/llm/usage?to=2026-09-25T00:00:00Z&from=2026-09-01', connected)
  check('a usage query keeps only from and to, URL-encoded', canonical.ok === true && canonical.path === '/v1/workspaces/' + W1 + '/llm/usage?to=2026-09-25T00%3A00%3A00Z&from=2026-09-01', JSON.stringify(canonical))
}

console.log('what it refuses')
{
  const no = (label, target, why) => {
    const r = relayCheck(target, connected)
    check('refused: ' + label, r.ok === false, JSON.stringify(r))
    if (why !== undefined) check('  … as ' + why, r.error === why, r.error)
  }
  no('another API route (keys)', '/v1/keys')
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
  no('a repeated parameter', '/v1/workspaces/' + W1 + '/llm/usage?from=2026-09-01&from=2026-09-02')
  no('an empty target', '')
  no('a target of the wrong type', null)
  no('a very long target', '/v1/workspaces/' + W1 + '/llm/usage?from=' + '2'.repeat(400))
  no('a workspace that is not one of the account\'s', '/v1/workspaces/' + WX + '/llm/budget', 'espace_inconnu')
  no('a workspace id that is not a uuid', '/v1/workspaces/not-a-uuid/members')
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
  const refused = await route.run({ url: '/kybernos-cloud/relay?p=' + encodeURIComponent('/v1/keys') })
  check('a path off the allowlist is refused with no call at all', refused.ok === false && refused.error === 'chemin refuse' && seen.length === before)
  check('no p parameter: refused with no call', (await route.run({ url: '/kybernos-cloud/relay' })).ok === false && seen.length === before)
}

console.log('the wiring (drift tests)')
{
  const here = dirname(fileURLToPath(import.meta.url))
  const host = readFileSync(join(here, 'index.js'), 'utf8')
  check('the dispatcher applies the strict guard to strict routes', host.indexOf('route.strict === true && sameOriginStrict(req) === false') > 0)
  check('every relay rule is a GET-only read: none names keys, invites or a write', RELAY_NO_WRITE(mod.RELAY_RULES))
}

function RELAY_NO_WRITE (rules) {
  return rules.every((r) => !/keys|invite|remove|checkout|subscribe/.test(r.re.source))
}

api.close()
rmSync(dir, { recursive: true, force: true })
console.log('\n' + (failed === 0 ? 'all checks OK' : failed + ' check(s) failed'))
process.exit(failed === 0 ? 0 : 1)
