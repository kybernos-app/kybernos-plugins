#!/usr/bin/env node
// Kaby from an outside assistant (the MCP server `/v1/mcp/kaby` of the server), against the disposable server replica of the user-journey recette.
//
//   source <the recette's env.sh> && node scripts/check-kaby-mcp-live.mjs [--out <dir>]
//
// What it does: signs up its OWN made-up account on the replica (never the recette's accounts), then plays what an outside assistant does: discovery, a registered client, PKCE, the
// person's "allow" on the consent request, the code for tokens, then the MCP handshake, the tool list and one call of each tool. It reads what the answers say about approvals:
// the assistant can ask or propose, only the person acts. Nothing leaves the replica (made-up data, stand-in mail and billing). Tokens are never printed or saved.
// It needs KB_E2E_API / KB_E2E_WEB / KB_E2E_CONTROL / KB_E2E_DIR (lib-e2e-server.mjs). Exit code 0 pass, 1 fail, 3 wrong environment (no replica, or the MCP flag is off).
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { env as serverEnv, fresh, makeServer } from './lib-e2e-server.mjs'

const args = process.argv.slice(2)
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : null
let pass = 0
let fail = 0
const seen = []
const check = (name, ok, detail) => {
  seen.push({ name, ok: ok === true, detail })
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 400))) }
}
const say = (name, detail) => { seen.push({ name, ok: true, detail }); console.log('  · ' + name + ' — ' + JSON.stringify(detail).slice(0, 600)) }

let e
try { e = serverEnv() } catch (err) { console.log('no replica in the environment: ' + err.message); process.exit(3) }
const server = makeServer(e)
const alive = await fetch(e.api + '/.well-known/oauth-authorization-server').then((r) => r.status).catch(() => 0)
if (alive !== 200) {
  // A replica that is up but whose owner's switch `mcp_kaby_enabled` is 0 answers 404 here (and a 401 on the MCP address whose WWW-Authenticate points to that missing document).
  const probe = await fetch(e.api + '/v1/mcp/kaby', { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-ip': '198.71.250.1' }, body: '{}' }).then((r) => ({ status: r.status, www: r.headers.get('www-authenticate') })).catch(() => ({ status: 0, www: null }))
  console.log('the replica does not publish the OAuth discovery (' + alive + '; the MCP address answers ' + probe.status + '): the owner\'s switch mcp_kaby_enabled is off, or the replica is not running. This check does not change the replica\'s settings.')
  process.exit(3)
}

let ipSeq = Math.floor(Math.random() * 50000)
const plain = async (method, path, { form, json, headers = {}, bearer } = {}) => {
  const h = { 'x-test-ip': `198.71.${(ipSeq >> 8) & 255}.${(ipSeq++ & 255) || 1}`, ...headers }
  let body
  if (form !== undefined) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString() }
  if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json) }
  if (bearer !== undefined) h.authorization = 'Bearer ' + bearer
  return fetch(e.api + path, { method, headers: h, body, redirect: 'manual' })
}
const pathOf = (a) => { const u = new URL(a); return u.pathname + u.search }

// ── my own account ──
const me = fresh('mcp')
await server.signUp(me.email, me.password, me.name)
const session = await server.signIn(me.email, me.password)
check('own made-up account signed up and signed in on the replica', typeof session.cookie === 'string' && session.cookie.length > 0)

// ── discovery ──
const prmRes = await plain('GET', '/.well-known/oauth-protected-resource/v1/mcp/kaby')
const prm = prmRes.status === 200 ? await prmRes.json() : null
const asRes = await plain('GET', '/.well-known/oauth-authorization-server')
const as = await asRes.json()
check('discovery: the protected resource and the authorization server answer, PKCE S256 offered', prm !== null && Array.isArray(as.code_challenge_methods_supported) && as.code_challenge_methods_supported.includes('S256'), { prm: prmRes.status })
say('scopes the resource supports', prm ? prm.scopes_supported : null)

// ── a call with no token ──
const noTok = await plain('POST', '/v1/mcp/kaby', { json: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'r5', version: '1' } } } })
check('no token: refused with 401 and a way to find the authorization server', noTok.status === 401 && /resource_metadata|Bearer/i.test(noTok.headers.get('www-authenticate') || ''), { status: noTok.status, header: noTok.headers.get('www-authenticate') })

// ── the consent circuit, with every scope the resource lists ──
const redirect = `https://assistant-${randomBytes(4).toString('hex')}.example.test/cb`
const reg = await plain('POST', pathOf(as.registration_endpoint), { json: { client_name: 'R5 outside assistant', redirect_uris: [redirect], token_endpoint_auth_method: 'none' } })
const regBody = reg.status === 201 ? await reg.json() : null
check('dynamic client registration (a public client)', reg.status === 201 && regBody !== null && typeof regBody.client_id === 'string', { status: reg.status })
const verifier = randomBytes(32).toString('base64url')
const challenge = createHash('sha256').update(verifier).digest('base64url')
const scope = (prm && Array.isArray(prm.scopes_supported) ? prm.scopes_supported : ['kaby.read']).join(' ')
const q = new URLSearchParams({ response_type: 'code', client_id: regBody ? regBody.client_id : '', redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', scope, state: 's1', resource: prm ? prm.resource : '' })
const go = await plain('GET', pathOf(as.authorization_endpoint) + '?' + q.toString())
const loc = go.headers.get('location') || ''
const requestId = (/#authorize&request=([A-Za-z0-9_-]{43})$/.exec(loc) || [])[1] || null
check('the authorization request is parked for the person (303 to the consent page, nothing granted yet)', go.status === 303 && requestId !== null, { status: go.status })
let tokens = null
if (requestId !== null) {
  const consent = await server.call('GET', `/v1/oauth/requests/${requestId}`, { cookie: session.cookie })
  say('what the consent page is told (scopes and client), as the person sees it', { status: consent.status, body: consent.body })
  const decide = await server.call('POST', `/v1/oauth/requests/${requestId}/decide`, { cookie: session.cookie, json: { decision: 'allow' } })
  say('the person answers allow', { status: decide.status, error: decide.status === 200 ? null : decide.body })
  if (decide.status === 200) {
    const back = new URL(decide.body.redirect)
    const code = back.searchParams.get('code')
    const tok = await plain('POST', pathOf(as.token_endpoint), { form: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect, client_id: regBody.client_id, resource: prm.resource } })
    tokens = tok.status === 200 ? await tok.json() : null
    check('the code is traded for tokens (the code works once)', tok.status === 200 && tokens !== null && typeof tokens.access_token === 'string', { status: tok.status })
    const again = await plain('POST', pathOf(as.token_endpoint), { form: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect, client_id: regBody.client_id, resource: prm.resource } })
    check('the same code a second time is refused', again.status >= 400, { status: again.status })
  }
}

// ── the MCP session ──
let ids = 0
const rpc = async (method, params) => {
  ids += 1
  const res = await plain('POST', '/v1/mcp/kaby', { bearer: tokens.access_token, json: { jsonrpc: '2.0', id: ids, method, ...(params === undefined ? {} : { params }) } })
  const text = await res.text()
  let body = null
  try { body = text === '' ? null : JSON.parse(text) } catch (err) { body = { raw: text.slice(0, 200) } }
  return { status: res.status, body }
}
const call = async (name, a) => {
  const r = await rpc('tools/call', { name, arguments: a === undefined ? {} : a })
  const res = r.body && r.body.result
  return { status: r.status, error: r.body && r.body.error ? r.body.error : null, isError: !!(res && res.isError), data: res && res.structuredContent ? res.structuredContent : null, text: res && res.content && res.content[0] ? String(res.content[0].text || '').slice(0, 400) : null }
}
const result = { tools: [], calls: {} }
if (tokens !== null) {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'r5', version: '1' } })
  check('initialize answers with the server info and its tools capability', init.status === 200 && init.body && init.body.result && init.body.result.capabilities && typeof init.body.result.capabilities === 'object', { status: init.status, body: init.body })
  await plain('POST', '/v1/mcp/kaby', { bearer: tokens.access_token, json: { jsonrpc: '2.0', method: 'notifications/initialized' } })
  const list = await rpc('tools/list')
  const tools = list.body && list.body.result ? list.body.result.tools : []
  result.tools = tools.map((t) => ({ name: t.name, readOnly: t.annotations ? t.annotations.readOnlyHint : undefined, destructive: t.annotations ? t.annotations.destructiveHint : undefined, required: t.inputSchema ? t.inputSchema.required : undefined }))
  check('tools/list lists the tools of the ADR', tools.length > 0, { status: list.status, error: list.body && list.body.error })
  say('tools', result.tools)
  const first = async (name, a) => { const r = await call(name, a); result.calls[name] = r; return r }
  const names = new Set(tools.map((t) => t.name))
  if (names.has('list_automations')) { const r = await first('list_automations'); say('list_automations', { isError: r.isError, error: r.error, text: r.text }) }
  if (names.has('list_runs')) { const r = await first('list_runs'); say('list_runs', { isError: r.isError, error: r.error, text: r.text }) }
  if (names.has('list_pending_approvals')) { const r = await first('list_pending_approvals'); say('list_pending_approvals', { isError: r.isError, error: r.error, text: r.text }) }
  if (names.has('get_automation')) { const r = await first('get_automation', { id: 'does-not-exist' }); say('get_automation on an unknown id', { isError: r.isError, error: r.error, text: r.text }) }
  if (names.has('get_run')) { const r = await first('get_run', { id: 'does-not-exist' }); say('get_run on an unknown id', { isError: r.isError, error: r.error, text: r.text }) }
  if (names.has('run_automation')) { const r = await first('run_automation', { id: 'does-not-exist' }); say('run_automation on an unknown id', { isError: r.isError, error: r.error, text: r.text }) }
  if (names.has('kaby_ask')) { const r = await first('kaby_ask', { question: 'What is waiting for me? (made-up question from the recette)' }); say('kaby_ask', { isError: r.isError, error: r.error, text: r.text }) }
  if (names.has('kaby_send_note')) { const r = await first('kaby_send_note', { note: 'R5 made-up note from an outside assistant' }); say('kaby_send_note', { isError: r.isError, error: r.error, text: r.text }) }
  if (names.has('propose_page')) { const r = await first('propose_page', { title: 'R5 made-up page', html: '<p>made-up</p>' }); say('propose_page', { isError: r.isError, error: r.error, text: r.text }) }
  if (names.has('get_publication')) { const r = await first('get_publication', { id: 'does-not-exist' }); say('get_publication on an unknown id', { isError: r.isError, error: r.error, text: r.text }) }
  if (names.has('read_artifact')) { const r = await first('read_artifact', { id: 'does-not-exist' }); say('read_artifact on an unknown id', { isError: r.isError, error: r.error, text: r.text }) }
  // the person revokes the grant: the token stops working at once
  const grants = await server.call('GET', '/v1/oauth/grants', { cookie: session.cookie })
  const grant = grants.status === 200 && grants.body && Array.isArray(grants.body.grants) ? grants.body.grants.find((g) => g.status === 'active') : null
  if (grant) {
    const del = await server.call('DELETE', `/v1/oauth/grants/${grant.id}`, { cookie: session.cookie })
    say('the person disconnects the assistant', { status: del.status })
    const after = await rpc('tools/list')
    check('after the disconnect the same token is refused', after.status === 401 || (after.body && after.body.error), { status: after.status })
  }
}

if (outDir !== null) { mkdirSync(outDir, { recursive: true }); writeFileSync(join(outDir, 'kaby-mcp-live.json'), JSON.stringify({ pass, fail, seen, result }, null, 2)) }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
