// The host routes behind the upgrade popup: the plans and their quotes (public data), the payment page, the customer portal, and the `section` of the console link.
//   node packages/kybernos-cloud/test-billing-proxy.mjs
//
// The popup is a page of DSH and the device token must never reach it. What matters here: the token goes out in an Authorization header and nowhere else (and not at all on
// the public calls), only the account's own workspaces are asked for, the server's SENTENCES never reach the page (a status and an error code do), the payment page is opened
// in the system browser (the opener is injected: no real browser here), and a server that does not know `section` or does not trust our return addresses still works.
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

const W1 = '11111111-1111-4111-8111-111111111111'
const WX = '99999999-9999-4999-8999-999999999999'
const TOKEN = 'kys-secret-token-0123456789'

const seen = []
let answer = null
const api = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, body: raw })
    const a = typeof answer === 'function' ? answer(req.url, raw) : answer
    res.writeHead(a.status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(a.body))
  })
})
await new Promise((r) => api.listen(0, '127.0.0.1', r))
const origin = 'http://127.0.0.1:' + api.address().port

const dir = mkdtempSync(join(tmpdir(), 'kb-billing-proxy-'))
process.env.KYBERNOS_CLOUD_API = origin
process.env.KYBERNOS_CLOUD_STATE = join(dir, 'state.json')
const writeState = (state) => writeFileSync(process.env.KYBERNOS_CLOUD_STATE, JSON.stringify(state))
const connected = { token: TOKEN, user: { email: 'a@b.test' }, workspaces: [{ id: W1, name: 'Acme' }], active_workspace_id: W1 }

const mod = await import('./index.js')
const route = (p) => mod.ROUTES.find((r) => r.path === p)
const req = (url) => ({ url, socket: { remoteAddress: '127.0.0.1' }, headers: {} })
const loopback = { socket: { remoteAddress: '127.0.0.1' }, headers: {} }

console.log('the routes')
{
  const g = (p) => route(p)
  check('the plans and the quote are strict, guarded GETs', ['/kybernos-cloud/plans', '/kybernos-cloud/plans/quote'].every((p) => g(p) !== undefined && g(p).method === 'GET' && g(p).guarded === true && g(p).strict === true))
  check('checkout and portal are strict, guarded POSTs with a small body', ['/kybernos-cloud/billing/checkout', '/kybernos-cloud/billing/portal'].every((p) => g(p) !== undefined && g(p).method === 'POST' && g(p).guarded === true && g(p).strict === true && g(p).body === true && g(p).cap <= 4096))
}

console.log('plans and quotes (public: no token goes out)')
{
  writeState({})
  seen.length = 0
  answer = { status: 200, body: { plans: [{ key: 'solo', kind: 'individual' }], credits_per_usd: 3680, tax_basis: 'exclusive' } }
  const r = await mod.plansRoute(req('/kybernos-cloud/plans?currency=eur'))
  check('the catalogue comes back (even signed out: it is public)', r.ok === true && r.plans.length === 1 && r.credits_per_usd === 3680 && r.tax_basis === 'exclusive', JSON.stringify(r))
  check('one GET /v1/plans?currency=EUR, with no Authorization header', seen.length === 1 && seen[0].method === 'GET' && seen[0].url === '/v1/plans?currency=EUR' && seen[0].auth === null, JSON.stringify(seen))
  seen.length = 0
  const bad = await mod.plansRoute(req('/kybernos-cloud/plans?currency=eu%2Fr'))
  check('a currency that is not three letters is refused with no call', bad.ok === false && bad.status === 400 && seen.length === 0, JSON.stringify(bad))
  answer = { status: 400, body: { error: 'unknown_currency', message: 'Unknown currency XXX. Sentence of the server.' } }
  const unknown = await mod.plansRoute(req('/kybernos-cloud/plans?currency=xxx'))
  check('a refusal is a status and a code, never the server\'s sentence', unknown.ok === false && unknown.status === 400 && unknown.error === 'unknown_currency' && JSON.stringify(unknown).indexOf('Sentence') < 0, JSON.stringify(unknown))
  answer = { status: 200, body: { nothing: true } }
  check('an answer that is not a catalogue is a failure, not a crash', (await mod.plansRoute(req('/kybernos-cloud/plans'))).ok === false)

  answer = { status: 200, body: { tax_basis: 'inclusive', currency: 'USD', interval: 'year', total: '468.00', monthly_total: '39.00', lines: [{ label: 'Per seat', quantity: 12, unit: '39.00', subtotal: '468.00' }], extra: 'dropped' } }
  seen.length = 0
  const q = await mod.planQuote(req('/kybernos-cloud/plans/quote?plan=team&currency=usd&quantity=12&interval=year'))
  check('the quote comes back reduced to what the popup shows', q.ok === true && q.quote.total === '468.00' && q.quote.monthly_total === '39.00' && q.quote.interval === 'year' && q.quote.lines.length === 1 && q.quote.lines[0].quantity === 12 && JSON.stringify(q).indexOf('dropped') < 0, JSON.stringify(q))
  check('one GET on /v1/plans/team/quote with the query, no Authorization', seen.length === 1 && seen[0].url === '/v1/plans/team/quote?currency=USD&quantity=12&interval=year' && seen[0].auth === null, JSON.stringify(seen))
  seen.length = 0
  const worse = await Promise.all(['plan=../v1/me&currency=usd', 'plan=team&currency=us', 'plan=team&currency=usd&quantity=0', 'plan=team&currency=usd&quantity=1e3', 'plan=team&currency=usd&interval=week', 'plan=solo&currency=usd&component=a%20b'].map((qs) => mod.planQuote(req('/kybernos-cloud/plans/quote?' + qs))))
  check('a plan, currency, quantity, interval or level that is not well formed is refused with no call', worse.every((x) => x.ok === false && x.status === 400) && seen.length === 0, JSON.stringify(worse))
}

console.log('the payment page')
{
  writeState(connected)
  const stripe = 'https://checkout.stripe.test/c/pay/cs_test_123'
  answer = { status: 200, body: { url: stripe, session_id: 'cs_test_123' } }
  seen.length = 0
  const opened = []
  const opener = (result) => async (url) => { opened.push(url); return result }
  let r = await mod.billingCheckout(loopback, { plan: 'solo', component: 'studio', currency: 'usd', interval: 'year', open: true }, { openExternal: opener(true) })
  check('open: the host opens the payment page itself and does not hand it to the page', r.ok === true && r.opened === true && r.url === undefined && opened.length === 1 && opened[0] === stripe, JSON.stringify(r))
  const sent = seen.length === 1 ? JSON.parse(seen[0].body) : null
  check('one POST to the workspace\'s checkout, the token as Authorization, the active workspace', seen.length === 1 && seen[0].method === 'POST' && seen[0].url === '/v1/workspaces/' + W1 + '/billing/checkout' && seen[0].auth === 'Bearer ' + TOKEN, JSON.stringify(seen))
  check('the body names the plan, the level, a quantity of 1, the currency upper-cased and the interval', sent !== null && sent.plan === 'solo' && sent.component === 'studio' && sent.quantity === 1 && sent.currency === 'USD' && sent.interval === 'year', JSON.stringify(sent))
  check('the person comes back to the server\'s own account page, on this workspace\'s plan', sent !== null && sent.success_url === origin + '/account?paid=1#plan&ws=' + W1 && sent.cancel_url === origin + '/account?paid=0#plan&ws=' + W1, JSON.stringify(sent))
  check('the token is nowhere in the answer', JSON.stringify(r).indexOf(TOKEN) < 0)

  opened.length = 0
  r = await mod.billingCheckout(loopback, { plan: 'team', quantity: 5, currency: 'EUR', open: true }, { openExternal: opener(false) })
  check('no browser to open: the address comes back, opened: false', r.ok === true && r.opened === false && r.url === stripe, JSON.stringify(r))
  const openedBefore = opened.length
  r = await mod.billingCheckout(loopback, { plan: 'team', quantity: 5, currency: 'EUR' }, { openExternal: opener(true) })
  check('without the wish to open, nothing is opened and the address comes back', r.ok === true && r.url === stripe && r.opened === undefined && opened.length === openedBefore, JSON.stringify(r))
  r = await mod.billingCheckout({ socket: { remoteAddress: '10.1.2.3' }, headers: {} }, { plan: 'team', quantity: 5, currency: 'EUR', open: true }, { openExternal: opener(true) })
  check('a peer that is not on this machine never makes the host open a browser', r.ok === true && r.opened === false && r.url === stripe, JSON.stringify(r))

  seen.length = 0
  const other = await mod.billingCheckout(loopback, { workspace_id: WX, plan: 'solo', currency: 'usd' }, {})
  const worse = await Promise.all([
    { plan: '../x', currency: 'usd' }, { plan: 'solo', currency: 'dollar' }, { plan: 'solo', currency: 'usd', quantity: 0 }, { plan: 'solo', currency: 'usd', quantity: 1.5 },
    { plan: 'solo', currency: 'usd', interval: 'week' }, { plan: 'solo', currency: 'usd', component: 'a b' },
  ].map((b) => mod.billingCheckout(loopback, b, {})))
  check('a workspace that is not the account\'s is refused with no call', other.ok === false && other.error === 'espace_inconnu' && seen.length === 0, JSON.stringify(other))
  check('a body that is not well formed is refused with no call', worse.every((x) => x.ok === false && x.status === 400) && seen.length === 0, JSON.stringify(worse))

  writeState({})
  seen.length = 0
  const none = await mod.billingCheckout(loopback, { plan: 'solo', currency: 'usd' }, {})
  check('not connected: nothing is called', none.ok === false && none.connected === false && seen.length === 0, JSON.stringify(none))
  writeState(connected)

  // What the person is told depends on the status and the code; the server's own sentence never goes through.
  for (const [status, code] of [[501, 'billing_disabled'], [403, 'forbidden'], [409, 'already_subscribed'], [422, 'seats_below_members'], [502, 'bad_gateway'], [404, 'not_found'], [429, 'rate_limited']]) {
    answer = { status, body: { error: code, message: 'The sentence of the server, with a Bearer ' + TOKEN } }
    const f = await mod.billingCheckout(loopback, { plan: 'team', quantity: 3, currency: 'usd' }, {})
    check(status + ' ' + code + ' comes back as a status and a code only', f.ok === false && f.status === status && f.error === code && JSON.stringify(f).indexOf('sentence') < 0 && JSON.stringify(f).indexOf(TOKEN) < 0, JSON.stringify(f))
  }
  answer = { status: 500, body: { error: 'Not a code: Because Of Spaces' } }
  const odd = await mod.billingCheckout(loopback, { plan: 'team', quantity: 3, currency: 'usd' }, {})
  check('an error that is not a code is reduced to « refuse »', odd.ok === false && odd.error === 'refuse', JSON.stringify(odd))
  answer = { status: 200, body: { url: 'javascript:alert(1)', session_id: 's' } }
  const js = await mod.billingCheckout(loopback, { plan: 'team', quantity: 3, currency: 'usd' }, {})
  check('a payment page that is not http(s) is never handed over', js.ok === false && js.error === 'lien_invalide' && js.url === undefined, JSON.stringify(js))

  // A server whose web app is not on its trusted list refuses the return addresses: ask again without them.
  let calls = 0
  seen.length = 0
  answer = (url, raw) => {
    calls += 1
    const b = JSON.parse(raw)
    if (b.success_url !== undefined) return { status: 422, body: { error: 'invalid_redirect', message: 'no' } }
    return { status: 200, body: { url: stripe, session_id: 's' } }
  }
  const retried = await mod.billingCheckout(loopback, { plan: 'team', quantity: 3, currency: 'usd' }, {})
  check('invalid_redirect: asked again without the return addresses, and it works', retried.ok === true && retried.url === stripe && calls === 2 && JSON.parse(seen[1].body).success_url === undefined, JSON.stringify([retried, calls]))
}

console.log('the workspace of a call')
{
  // No `workspace_id` and none chosen yet: the first workspace is the active one (the footer card shows it too).
  writeState({ token: TOKEN, user: { email: 'a@b.test' }, workspaces: [{ id: W1, name: 'Acme' }] })
  answer = { status: 200, body: { url: 'https://checkout.stripe.test/c/pay/cs_1', session_id: 'cs_1' } }
  seen.length = 0
  const r = await mod.billingCheckout(loopback, { plan: 'solo', component: 'solo', currency: 'usd' }, {})
  check('with no active workspace chosen, the first one is used', r.ok === true && seen.length === 1 && seen[0].url === '/v1/workspaces/' + W1 + '/billing/checkout', JSON.stringify([r, seen]))
}

console.log('the customer portal')
{
  writeState(connected)
  const portal = 'https://billing.stripe.test/p/session/test_abc'
  answer = { status: 200, body: { url: portal } }
  seen.length = 0
  const opened = []
  let r = await mod.billingPortal(loopback, { open: true }, { openExternal: async (u) => { opened.push(u); return true } })
  check('the portal opens in the system browser', r.ok === true && r.opened === true && opened[0] === portal && r.url === undefined, JSON.stringify(r))
  check('one POST to the workspace\'s portal with the token and a return address', seen.length === 1 && seen[0].url === '/v1/workspaces/' + W1 + '/billing/portal' && seen[0].auth === 'Bearer ' + TOKEN && JSON.parse(seen[0].body).return_url === origin + '/account?back=1#plan&ws=' + W1, JSON.stringify(seen))
  answer = { status: 404, body: { error: 'not_found', message: 'Nothing bought yet.' } }
  r = await mod.billingPortal(loopback, {}, {})
  check('nothing bought yet: a 404 and a code', r.ok === false && r.status === 404 && r.error === 'not_found', JSON.stringify(r))
  answer = { status: 501, body: { error: 'billing_disabled' } }
  r = await mod.billingPortal(loopback, {}, {})
  check('no payment provider: 501 billing_disabled', r.ok === false && r.status === 501 && r.error === 'billing_disabled', JSON.stringify(r))
  seen.length = 0
  r = await mod.billingPortal(loopback, { workspace_id: WX }, {})
  check('a workspace that is not the account\'s is refused with no call', r.ok === false && r.error === 'espace_inconnu' && seen.length === 0)
}

console.log('the console link: `section`')
{
  writeState(connected)
  const link = { status: 200, body: { url: origin + '/api/auth/magic-link/verify?token=abc&callbackURL=%2Faccount', expires_in: 60 } }
  answer = link
  seen.length = 0
  let r = await mod.consoleLink(loopback, { section: 'overview', workspace_id: W1 }, {})
  check('the section is forwarded with the workspace', r.ok === true && seen.length === 1 && JSON.parse(seen[0].body).section === 'overview' && JSON.parse(seen[0].body).workspace_id === W1, JSON.stringify(seen))
  seen.length = 0
  r = await mod.consoleLink(loopback, { section: '../../etc' }, {})
  check('a section that is not a short slug is dropped, not forwarded', r.ok === true && seen.length === 1 && JSON.parse(seen[0].body).section === undefined, JSON.stringify(seen))
  // An older server ignores the field (the link lands on its plan page: nothing to do) or refuses the body: ask again without it.
  seen.length = 0
  answer = (url, raw) => (JSON.parse(raw).section !== undefined ? { status: 422, body: { error: 'validation' } } : link)
  r = await mod.consoleLink(loopback, { section: 'overview' }, {})
  check('a server that refuses the body: asked again without `section`, and the link still comes', r.ok === true && seen.length === 2 && JSON.parse(seen[1].body).section === undefined, JSON.stringify([r, seen]))
  answer = { status: 403, body: { error: 'email_not_verified' } }
  seen.length = 0
  r = await mod.consoleLink(loopback, { section: 'overview' }, {})
  check('another refusal is not retried', r.ok === false && r.status === 403 && seen.length === 1, JSON.stringify([r, seen]))
}

api.close()
console.log('\n' + (failed === 0 ? 'all checks OK' : failed + ' check(s) failed'))
process.exit(failed === 0 ? 0 : 1)
