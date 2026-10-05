// A stand-in for the DSH page and its host, to exercise the Team settings console the way DSH runs it: no key, the console
// asks its parent page, the parent asks a local relay route.   scripts/check-team-live.mjs uses it for its « relay » section.
//
//   const host = await startRelayHost({ consoleHtml })      // { url, asked, refused, close() }
//   open host.url + '/parent.html'                          // the console in an iframe, no key anywhere
//   open host.url + '/parent.html?offline=1'                // the account is not signed in
//   open host.url + '/parent.html?ws=<id>'                  // the app has THIS workspace active: the console opens on it
//   open host.url + '/parent.html?llm=down'                 // signed in, but the LLM service is not configured (503 on /llm/*)
//
// What is real here, so that a drift is caught instead of copied:
//   - the broker in the parent page is the code shipped in packages/kybernos-plugin/client.js, cut out of the source;
//   - the route's allowlist is relayCheck() of packages/kybernos-cloud/index.js: a path the console asks for that the
//     allowlist does not name comes back refused, and is listed in `refused`.
// What is not: the answers (main-API and LLM-service shapes, from this file), and the origin (the page and the console
// share one, so the test can read the iframe; the origin check itself is proven in test-console-broker.mjs).
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FAKE_TEAM_ID, ROUTES } from './lib-fake-team-gateway.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const SECOND_TEAM_ID = '22222222-2222-4222-8222-222222222222'
export const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const BEA_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

// The shipped broker, cut out of the page component: from « const repondre » up to its addEventListener.
const brokerSnippet = () => {
  const source = readFileSync(join(here, '..', 'packages', 'kybernos-plugin', 'client.js'), 'utf8')
  const from = source.indexOf('const repondre = (fr, message) => {')
  const to = source.indexOf("window.addEventListener('message', sur)", from)
  if (from < 0 || to < from) throw new Error('the broker code moved in client.js: update scripts/lib-fake-relay-host.mjs')
  return source.slice(from, to)
}

const ANSWERS = {
  me: () => ({ id: OWNER_ID, name: 'Owner Person', plan: 'studio' }),
  workspaces: () => ({ workspaces: [{ id: FAKE_TEAM_ID, name: 'Acme Team', kyber_count: 0, created_at: '2026-08-01 10:00:00+00:00' }, { id: SECOND_TEAM_ID, name: 'Beta Team', kyber_count: 0, created_at: '2026-08-15 10:00:00+00:00' }] }),
  members: () => ({ members: [{ user_id: OWNER_ID, role: 'owner', status: 'active', created_at: '2026-08-01 10:00:00+00:00' }, { user_id: BEA_ID, role: 'member', status: 'active', created_at: '2026-08-02 10:00:00+00:00' }] }),
  budget: () => ({ plan: { pack: 'full', monthly_usd: 50, min_members: 2 }, shared_remaining: 12.5, members: [{ user_ref: OWNER_ID }, { user_ref: BEA_ID }] }),
  usage: () => ({ usage: [{ ts: '2026-09-01T10:00:00Z', team_id: FAKE_TEAM_ID, user_ref: OWNER_ID, model: 'claude-x', credits: 1.2 }, { ts: '2026-09-02T10:00:00Z', team_id: FAKE_TEAM_ID, user_ref: BEA_ID, model: 'glm-y', credits: 0.4 }] }),
  llmModels: () => ROUTES['GET /models'](),
  catalog: () => ROUTES['GET /v1/catalog/models'](),
  billing: () => ROUTES['GET /billing'](),
  providers: () => ROUTES['GET /providers'](),
  byokModels: () => ROUTES['GET /workspace-models'](),
}

const answerFor = (path) => {
  if (path === '/v1/me') return ANSWERS.me()
  if (path === '/v1/workspaces') return ANSWERS.workspaces()
  const m = path.match(/^\/v1\/workspaces\/[^/]+\/(members|providers|models|llm\/(budget|models|catalog|billing|usage))/)
  if (m === null) return null
  const key = m[1]
  if (key === 'members') return ANSWERS.members()
  if (key === 'providers') return ANSWERS.providers()
  if (key === 'models') return ANSWERS.byokModels()
  return { budget: ANSWERS.budget, models: ANSWERS.llmModels, catalog: ANSWERS.catalog, billing: ANSWERS.billing, usage: ANSWERS.usage }[m[2]]()
}

export async function startRelayHost ({ consoleHtml }) {
  const { relayCheck } = await import('../packages/kybernos-cloud/index.js')
  const snippet = brokerSnippet()
  const asked = []
  const refused = []
  const parentPage = (origin, ws) => '<!doctype html><meta charset="utf-8"><title>host</title><div class="kbwsif" style="height:100vh"><iframe src="/workspace-console.html?gw=' + encodeURIComponent('https://gateway.invalid') + '&theme=dark' + (ws ? '&ws=' + encodeURIComponent(ws) : '') + '" style="width:100%;height:100%;border:0"></iframe></div><script>\n' +
    'const kbWsOrigin = () => ' + JSON.stringify(origin) + '\nconst envoyerCle = () => {}\n' + snippet + "\nwindow.addEventListener('message', sur)\n</script>"
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const send = (status, type, body) => { res.writeHead(status, { 'content-type': type }); res.end(body) }
    if (url.pathname === '/workspace-console.html') return send(200, 'text/html; charset=utf-8', consoleHtml)
    if (url.pathname === '/parent.html') return send(200, 'text/html; charset=utf-8', parentPage('http://127.0.0.1:' + server.address().port, url.searchParams.get('ws')))
    if (url.pathname === '/kybernos-cloud/relay') {
      // The real host route's contract: { ok, status, body }, or { ok: false, connected: false } when not signed in.
      if (url.searchParams.get('offline') === '1' || req.headers.referer?.includes('offline=1')) return send(200, 'application/json', JSON.stringify({ ok: false, connected: false, status: 'none', error: 'non connecte' }))
      const target = url.searchParams.get('p') || ''
      const verdict = relayCheck(target, { workspaces: [{ id: FAKE_TEAM_ID }, { id: SECOND_TEAM_ID }] })
      if (verdict.ok !== true) { refused.push(target); return send(200, 'application/json', JSON.stringify({ ok: false, error: verdict.error })) }
      asked.push(verdict.path)
      // ?llm=down: the main API answers, the LLM service behind its relay is not configured (what the deployed API says today).
      if (req.headers.referer?.includes('llm=down') && verdict.path.includes('/llm/')) return send(200, 'application/json', JSON.stringify({ ok: false, status: 503, body: { error: 'LLM service not configured' } }))
      const body = answerFor(verdict.path)
      return send(200, 'application/json', JSON.stringify(body === null ? { ok: false, status: 404, body: null } : { ok: true, status: 200, body }))
    }
    send(404, 'text/plain', 'not here')
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { url: 'http://127.0.0.1:' + server.address().port, asked, refused, close: () => new Promise((r) => server.close(() => r())) }
}
