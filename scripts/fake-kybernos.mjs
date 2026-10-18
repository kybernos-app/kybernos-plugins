// A FAKE Kybernos server for the sandbox live checks of the teams features (scripts/check-join-live.mjs, scripts/check-team-folder-live.mjs).
//
//   const fake = await startFakeKybernos({ spaces: [P, ACME], invites: { [token]: {...} } })
//   fake.url  fake.calls  fake.spaces  fake.consumed  fake.down  fake.close()
//
// It answers the routes the host of kybernos-cloud reads when a person is connected (the account, the list of teams, a team's plan and budget, the model catalogue, creating a
// team, the two invitation routes) the way the real server's contract does, and records every request (method, address, device token, `x-kybernos-workspace`, body), so a check can say where
// a token went. A team is on the Team plan unless its id is in `fake.noPlan`; a team created through `POST /v1/workspaces` has no plan unless `fake.createdHavePlan` is true (the
// server's own words: « it starts without a plan »). `fake.down = true` hangs up on the invitation routes (a server that does not answer).
import { createServer } from 'node:http'

export const DEVICE_TOKEN = 'kys_fake_join_token'
export const ME = { id: 'u-1', name: 'Dev Person', email: 'dev@example.test', plan: 'team' }
export const PERSONAL = { id: '11111111-1111-4111-8111-111111111111', name: 'My workspace', personal: true, role: 'owner', created_at: '2026-01-01T00:00:00Z' }
export const ACME = { id: '22222222-2222-4222-8222-222222222222', name: 'Acme', personal: false, role: 'admin', created_at: '2026-01-02T00:00:00Z' }
export const STUDIO = { id: '33333333-3333-4333-8333-333333333333', name: 'Studio B', personal: false, role: 'member', created_at: '2026-01-03T00:00:00Z' }

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', date: new Date().toUTCString() }); res.end(JSON.stringify(body)) }
const win = (kind, seconds, percent) => ({ kind, window_seconds: seconds, scope: 'plan', limit_usd: '10.00', spent_usd: '1.00', remaining_usd: '9.00', exhausted: false, used_percent: percent, resets_at: null })

/** @param {{ spaces?: object[], invites?: Record<string, { workspace: object, inviter: string | null, email: string, role: string, full?: boolean }>, busy?: string[], boom?: string[] }} options
 *  `busy` and `boom`: invitation tokens the server answers 429 and 500 to. */
export async function startFakeKybernos(options = {}) {
  const fake = { calls: [], spaces: (options.spaces || [PERSONAL, ACME]).slice(), consumed: new Set(), noPlan: new Set(), createdHavePlan: false, down: false, url: '', close: null }
  const invites = options.invites || {}
  let serial = 0
  const planOf = (space) => {
    if (space.personal) return { source: 'none', status: 'active', plan: { key: 'free', name: 'Free', kind: 'free' }, level: null, seats: 1, credit_balance_credits: 0 }
    if (fake.noPlan.has(space.id)) return { source: 'none', status: 'active', plan: null, level: null, seats: 1, credit_balance_credits: 0 }
    return { source: 'subscription', status: 'active', plan: { key: 'team', name: 'Team', kind: 'team' }, level: '1-5 seats', seats: 5, credit_balance_credits: 0 }
  }
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (d) => { raw += d })
    req.on('end', () => {
      const url = String(req.url).split('?')[0]
      const call = { method: req.method, url: String(req.url), path: url, auth: req.headers.authorization || null, ws: typeof req.headers['x-kybernos-workspace'] === 'string' ? req.headers['x-kybernos-workspace'] : null, body: raw }
      fake.calls.push(call)
      if (fake.down === true && url.startsWith('/v1/invitations/')) { req.socket.destroy(); return }
      let sent = {}
      try { sent = JSON.parse(raw || '{}') } catch (e) { sent = {} }
      if (req.method === 'POST' && (url === '/v1/invitations/preview' || url === '/v1/invitations/accept')) {
        const token = typeof sent.token === 'string' ? sent.token : ''
        const accept = url.endsWith('/accept')
        if ((options.busy || []).includes(token)) return json(res, 429, { error: 'rate_limited', message: 'Too many requests.' })
        if ((options.boom || []).includes(token)) return json(res, 500, { error: 'internal', message: 'boom' })
        const inv = invites[token]
        if (inv === undefined || (accept && fake.consumed.has(token))) return json(res, 404, { error: 'not_found', message: 'This invitation is invalid or has expired.' })
        if (!accept) return json(res, 200, { workspace_name: inv.workspace.name, inviter_name: inv.inviter, email: inv.email, role: inv.role, expires_at: '2026-10-25T10:00:00.000Z' })
        if (call.auth !== 'Bearer ' + DEVICE_TOKEN) return json(res, 401, { error: 'unauthorized', message: 'Sign in required.' })
        if (inv.email !== ME.email) return json(res, 404, { error: 'not_found', message: 'This invitation is invalid or has expired.' })
        if (inv.full === true) return json(res, 409, { error: 'seat_limit', message: 'No free seat.' })
        fake.consumed.add(token)
        if (!fake.spaces.some((s) => s.id === inv.workspace.id)) fake.spaces = fake.spaces.concat([inv.workspace])
        return json(res, 200, inv.workspace)
      }
      if (req.method === 'POST' && url === '/v1/workspaces') {
        serial += 1
        const made = { id: '99999999-9999-4999-8999-' + String(serial).padStart(12, '0'), name: typeof sent.name === 'string' ? sent.name : 'Unnamed', personal: false, role: 'owner', created_at: '2026-10-18T10:00:00Z' }
        if (fake.createdHavePlan !== true) fake.noPlan.add(made.id)
        fake.spaces = fake.spaces.concat([made])
        return json(res, 201, made)
      }
      if (url === '/v1/workspaces') return json(res, 200, { workspaces: fake.spaces })
      if (url === '/v1/me') return json(res, 200, ME)
      if (url === '/v1/models') return json(res, 200, { data: [{ id: 'kybernos/glm', object: 'model' }] })
      const m = /^\/v1\/workspaces\/([^/]+)\/(plan|llm\/budget|members)$/.exec(url)
      if (m !== null) {
        const space = fake.spaces.find((s) => s.id === m[1])
        if (space === undefined) return json(res, 404, { error: 'not_found' })
        if (m[2] === 'plan') return json(res, 200, planOf(space))
        if (m[2] === 'llm/budget') return json(res, 200, { windows: space.personal ? [win('member', 2592000, 3)] : [win('member', 18000, 12), win('member', 604800, 30), win('pool', 2592000, 40)] })
        return json(res, 200, { members: [] })
      }
      json(res, 404, { error: 'not_found', path: url })
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  fake.url = 'http://127.0.0.1:' + server.address().port
  fake.close = () => new Promise((resolve) => server.close(resolve))
  return fake
}
