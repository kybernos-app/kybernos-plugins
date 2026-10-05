// A stand-in for the LLM gateway and the team API behind the Team settings console, for scripts/check-team-live.mjs.
// It answers the calls the console's data bridge makes, with the SHAPES the real services return, so the console can be
// exercised with a key (live-data path) without any account or network. Read-only: every write answers 405.
//
//   const gw = await startFakeTeamGateway()      // { url, close(), teamId }
//
// When the console is rewired to other routes, change the table below: a drift here is the test doing its job.
import { createServer } from 'node:http'

export const FAKE_TEAM_ID = '11111111-1111-4111-8111-111111111111'

export const ROUTES = {
  'GET /v1/teams': () => ({ teams: [{ id: FAKE_TEAM_ID, name: 'Acme Team', created_at: '2026-08-01T10:00:00Z' }] }),
  'GET /budget': () => ({ plan: { pack: 'full', monthly_usd: 50, min_members: 2 }, shared_remaining: 12.5, members: [{ user_ref: 'owner@acme.test' }, { user_ref: 'bea@acme.test' }] }),
  'GET /members': () => ({ members: [{ user_ref: 'owner@acme.test', role: 'owner', max_shared_share: 20 }, { user_ref: 'bea@acme.test', role: 'member', max_shared_share: 5 }] }),
  'GET /payments': () => ({ payments: [{ ref: 'pi_123456789', credits: 50, created_at: '2026-09-10T10:00:00Z' }] }),
  'GET /v1/usage': () => ({ usage: [{ ts: '2026-09-01T10:00:00Z', user_ref: 'owner@acme.test', model: 'claude-x', credits: 1.2 }, { ts: '2026-09-02T10:00:00Z', user_ref: 'bea@acme.test', model: 'glm-y', credits: 0.4 }] }),
  'GET /models': () => ({ models: ['claude-x'] }),
  'GET /billing': () => ({ pm: { brand: 'visa', last4: '4242', exp: '09/29' }, invoices: [{ id: 'in_abc123456', amount: 100, created: 1789000000, what: 'Team subscription', url: 'https://invoice.test/1' }], subscription: { current_period_end: 1793000000 } }),
  'GET /v1/catalog/models': () => ({ models: [{ id: 'claude-x', provider: 'anthropic', deployments: [{ api_base: null }, { api_base: null }] }, { id: 'glm-y', provider: 'zai', deployments: [{ api_base: null }] }] }),
  'GET /providers': () => ({ providers: [{ slug: 'openrouter', type: 'openai', base_url: 'https://openrouter.ai/api/v1', key_hint: '…abcd', enabled: true, model_count: 1, preset: 'openrouter' }], presets: ['anthropic', 'openai'], can_write: true, can_custom_url: false }),
  'GET /workspace-models': () => ({ models: [{ provider: 'openrouter', model: 'meta/llama-3', name: 'Llama 3' }] }),
  'GET /autorecharge': () => ({ rule: null }),
  'GET /profiles': () => ({ profiles: [] }),
  'GET /litellm/models': () => ({ models: [] }),
}

function routeKey (method, path) {
  if (path === '/v1/teams') return method + ' /v1/teams'
  if (path === '/v1/usage') return method + ' /v1/usage'
  if (path === '/v1/catalog/models') return method + ' /v1/catalog/models'
  if (/\/v1\/workspaces\/[^/]+\/providers$/.test(path)) return method + ' /providers'
  if (/\/v1\/workspaces\/[^/]+\/models$/.test(path)) return method + ' /workspace-models'
  const m = path.match(/\/v1\/teams\/[^/]+(\/.*)$/)
  return m ? method + ' ' + m[1] : method + ' ' + path
}

export function startFakeTeamGateway () {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      res.setHeader('access-control-allow-origin', '*')
      res.setHeader('access-control-allow-headers', 'content-type, authorization, x-signature')
      res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
      const path = new URL(req.url, 'http://x').pathname
      const answer = ROUTES[routeKey('GET', path)]
      if (req.method !== 'GET' || answer === undefined) {
        res.writeHead(answer === undefined ? 404 : 405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'stand-in gateway: ' + req.method + ' ' + path }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(answer()))
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve({ url: 'http://127.0.0.1:' + server.address().port, teamId: FAKE_TEAM_ID, close: () => new Promise((r) => server.close(() => r())) }))
  })
}
