// ═══════════════════════════════════════════════════════════════════════════
// @local/kybernos-free-llms — host: the local gateway to OpenCode Zen's free
// tier (no account, no API key) and the health/activation routes behind it.
//
// The gateway is what DSH's `opencode-free` provider points at: it receives an
// ordinary OpenAI chat request, rewrites it up to the free-tier request contract
// (gateway-contract.mjs), forwards it to opencode.ai, and streams the answer back
// as OpenAI-compatible SSE. Without the rewrite the upstream answers 403
// `FreeTierError`; the rules were measured barrier-by-barrier, not guessed.
//
// Honesty: the model LIST is read live from the upstream; nothing is invented.
// A model whose wire protocol the upstream does not serve reports
// `model_protocol_unsupported` rather than pretending to answer. The free tier may
// retain prompts for training (OpenCode Zen terms) — surfaced in the panel, never
// hidden.
// ═══════════════════════════════════════════════════════════════════════════
import { randomBytes } from 'node:crypto'
import { writeGuard } from './session-guard.mjs'
import {
  OPENCODE_USER_AGENT, applyContract, contractHeaders, classifyError,
} from './gateway-contract.mjs'
import { PROVIDER_ID, CREDENTIAL_REF, buildProfile, profileSummary } from './profile.mjs'
import { gatewayBase, routeNeedsRepair, ensureFreeKey } from './wiring.mjs'
import { createProbeCache } from './probe-cache.mjs'
import {
  defaultFreeLlmState, shouldAutoEnable, recordEnable, recordDisable, publicView,
} from './free-llm-state.mjs'

const UPSTREAM = 'https://opencode.ai/zen/v1'
const FREE_SUFFIX = /-free$/
const FREE_SPECIAL = new Set(['big-pickle'])

// ── small HTTP helpers (same contracts as the other bundles) ───────────────
const sendJson = (res, status, body) => {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  } catch (e) { try { res.end('{}') } catch (e2) { /* socket closed */ } }
}

const readBody = (req) => new Promise((resolve) => {
  let raw = ''
  try {
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 4_000_000) raw = raw.slice(0, 4_000_000) })
    req.on('end', () => { try { resolve(raw.length === 0 ? {} : JSON.parse(raw)) } catch (e) { resolve(null) } })
    req.on('error', () => resolve(null))
  } catch (e) { resolve(null) }
})

// Host fence (scripts/test-route-hosts.mjs). DSH serves plugin routes BEFORE its own
// authentication, so a DNS-rebinding page reaches them with its own name as Host. Every
// route refuses a Host that is not this listener's before its own guard runs.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
const kbHostOK = (req) => {
  try {
    const host = req.headers !== null && req.headers !== undefined && typeof req.headers.host === 'string' ? req.headers.host : null
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    if (host === null || sock === null || typeof sock.localPort !== 'number') return true
    const port = ':' + sock.localPort
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(host) >= 0 || kbTrusted(host)
  } catch (e) { return false }
}
const kbFenced = (service) => {
  if (service === null || service === undefined || typeof service.register !== 'function') return service
  const fence = (route) => (route !== null && typeof route === 'object' && typeof route.handler === 'function'
    ? Object.assign({}, route, {
      handler: (req, res, ...rest) => {
        if (kbHostOK(req) !== true) {
          try { res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' }); res.end('{"ok":false,"error":"origin refused"}') } catch (e) { /* closed */ }
          return undefined
        }
        return route.handler(req, res, ...rest)
      },
    })
    : route)
  return new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => target.register(fence(route)) : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) })
}

// Writes need a real same-origin POST (no Origin = refused), matching the core bundle.
const sameOriginStrict = (req) => {
  try {
    const headers = req.headers || {}
    const source = typeof headers.origin === 'string' && headers.origin !== '' ? headers.origin : (typeof headers.referer === 'string' ? headers.referer : null)
    if (source === null) return false
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    const port = (sock !== null && typeof sock.localPort === 'number') ? ':' + sock.localPort : ''
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host)
  } catch (e) { return false }
}

/**
 * The gateway's four open routes (chat completions, models, status, health) are called by DSH's ENGINE: a Node program with no Origin, no cookie and no
 * browser headers, so they cannot ask for a session like a page's routes do. What they refuse is a BROWSER page of another site: before this, a page the
 * person merely visited could POST text/plain to chat/completions (no preflight) and have the person's machine call opencode.ai, burning the free-tier
 * quota and the IP's reputation, or load /health (a real chat probe upstream) with a no-cors GET (A6-04). A browser marks such a request: an Origin that
 * is not this listener's, or Sec-Fetch-Site other than same-origin / none (another origin, another port of localhost, another site). The engine sends neither.
 */
const notFromAnotherPage = (req) => {
  try {
    const headers = req.headers || {}
    const site = typeof headers['sec-fetch-site'] === 'string' ? headers['sec-fetch-site'] : ''
    if (site !== '' && site !== 'same-origin' && site !== 'none') return false
    if (typeof headers.origin === 'string' && headers.origin !== '' && sameOriginStrict(req) !== true) return false
    return true
  } catch (e) { return false }
}
const refuseAnotherPage = (req, res) => {
  if (notFromAnotherPage(req) === true) return false
  sendJson(res, 403, { ok: false, error: 'origin' })
  return true
}

/**
 * The three routes of the Settings page and the first-run wizard (enable, disable, auto-enable) change where the person's model traffic goes: they write the `opencode-free` provider into
 * DSH's settings and store its marker key, and what the person types then leaves for opencode.ai. They need DSH's signed browser session as well as the right Origin (session-guard.mjs,
 * kybernos-terminal's rule, L3-21): plugin routes are served before DSH's own login, an Origin header is forgeable by any local program, and the body's `acknowledged` flag attests nothing.
 * Their callers are pages (this bundle's panel and the wizard of the core bundle), which carry the cookie by themselves; a paired phone is refused (`refused_on_phone`). The gateway routes
 * above are the engine's and keep the « not from another page » rule. Answers the refusal and returns true when the request must stop there.
 */
const refuseUnsigned = (req, res) => {
  const refused = writeGuard(req)
  if (refused === null) return false
  sendJson(res, refused.status, { ok: false, error: refused.error })
  return true
}

const str = (v) => (typeof v === 'string' && v !== '' ? v : null)

// ── host service access (settings, credentials) ────────────────────────────
let hostCtx = null
const service = (name) => {
  if (hostCtx === null || typeof hostCtx.get !== 'function') return null
  const svc = hostCtx.get(name)
  return svc === undefined ? null : svc
}

/** The free-model credential the gateway sends upstream. Pi-ai needs a key to send;
 *  the free tier accepts the literal `public` marker (measured: it routes to the
 *  zero-cost tier). Stored in the credential store so nothing secret sits in settings. */
const upstreamKey = async () => {
  const cred = service('credentials')
  if (cred !== null && typeof cred.get === 'function') {
    try {
      const rec = await cred.get(CREDENTIAL_REF)
      const key = rec && typeof rec.key === 'string' && rec.key !== '' ? rec.key : null
      if (key !== null) return key
    } catch (e) { /* fall through to default */ }
  }
  return 'public'
}

/** Which free models the upstream lists right now (id ends `-free`, or the known free special). */
const fetchFreeModels = async () => {
  try {
    const res = await fetch(UPSTREAM + '/models', {
      headers: { 'User-Agent': OPENCODE_USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return { ok: false, error: 'upstream_' + res.status, models: [] }
    const data = await res.json()
    const ids = Array.isArray(data && data.data) ? data.data.map((m) => m && m.id).filter((id) => typeof id === 'string') : []
    const free = ids.filter((id) => FREE_SUFFIX.test(id) || FREE_SPECIAL.has(id))
    return { ok: true, error: null, models: free }
  } catch (e) {
    return { ok: false, error: 'network', models: [] }
  }
}

/**
 * Forward one rewritten chat request upstream and stream the SSE back to the
 * caller as OpenAI-compatible chunks. Non-stream callers still get a single JSON
 * body (the contract forces stream upstream; we fold it back).
 */
const gatewayChat = async (req, res, incoming) => {
  const key = await upstreamKey()
  const { body } = applyContract(incoming)
  const headers = contractHeaders({ randomBytes, userAgent: null })
  headers['content-type'] = 'application/json'
  headers.authorization = 'Bearer ' + key

  let upstream
  try {
    upstream = await fetch(UPSTREAM + '/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    })
  } catch (e) {
    sendJson(res, 502, { error: { message: 'upstream unreachable', code: 'upstream_unreachable' } })
    return
  }

  const wantStream = incoming !== null && incoming.stream === true

  // A locked tier or a protocol-unsupported model comes back as JSON, not SSE.
  const ct = upstream.headers.get('content-type') || ''
  if (!upstream.ok && ct.includes('application/json')) {
    let parsed = null
    try { parsed = await upstream.json() } catch (e) { /* ignore */ }
    const code = classifyError(parsed)
    sendJson(res, upstream.status, {
      error: {
        message: parsed && parsed.error && parsed.error.message ? parsed.error.message : 'upstream error',
        code: code || 'upstream_error',
        type: parsed && parsed.error && parsed.error.type ? parsed.error.type : undefined,
      },
    })
    return
  }

  // Stream path: pipe upstream SSE through, renaming reasoning deltas to the OpenAI
  // `reasoning` field DSH understands. Text deltas pass through untouched.
  if (wantStream) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (payload === '[DONE]') { res.write('data: [DONE]\n\n'); continue }
            let chunk = null
            try { chunk = JSON.parse(payload) } catch (e) { continue }
            const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta
            if (delta && typeof delta.reasoning === 'string') {
              // pi-ai surfaces reasoning as `reasoning`; keep it in that field.
              res.write('data: ' + JSON.stringify(chunk) + '\n\n')
            } else {
              res.write('data: ' + JSON.stringify(chunk) + '\n\n')
            }
          }
        }
      }
      res.write('data: [DONE]\n\n')
    } catch (e) { /* client went away */ }
    res.end()
    return
  }

  // Non-stream path: fold the upstream SSE into one chat.completion JSON body.
  let text = ''
  let reasoning = ''
  let finish = 'stop'
  const decoder = new TextDecoder()
  let buffer = ''
  const reader = upstream.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') continue
          let chunk = null
          try { chunk = JSON.parse(payload) } catch (e) { continue }
          const choice = chunk && chunk.choices && chunk.choices[0]
          const delta = choice && choice.delta
          if (delta) {
            if (typeof delta.content === 'string') text += delta.content
            if (typeof delta.reasoning === 'string') reasoning += delta.reasoning
          }
          if (choice && typeof choice.finish_reason === 'string' && choice.finish_reason) finish = choice.finish_reason
        }
      }
    }
  } catch (e) { /* ignore */ }
  sendJson(res, 200, {
    id: 'free-llms-' + randomBytes(6).toString('hex'),
    object: 'chat.completion',
    model: typeof incoming.model === 'string' ? incoming.model : null,
    choices: [{ index: 0, message: { role: 'assistant', content: text, reasoning: reasoning || undefined }, finish_reason: finish }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  })
}

/** A tiny live probe: does one free model answer through the full contract right now? */
const healthProbe = async (model) => {
  const key = await upstreamKey()
  const { body } = applyContract({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8 })
  const headers = contractHeaders({ randomBytes, userAgent: null })
  headers['content-type'] = 'application/json'
  headers.authorization = 'Bearer ' + key
  try {
    const res = await fetch(UPSTREAM + '/chat/completions', {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    })
    const ct = res.headers.get('content-type') || ''
    if (res.ok && ct.includes('text/event-stream')) return { ok: true, code: 'ok' }
    let parsed = null
    try { parsed = await res.json() } catch (e) { /* ignore */ }
    return { ok: false, code: classifyError(parsed) || ('upstream_' + res.status), status: res.status }
  } catch (e) {
    return { ok: false, code: 'network' }
  }
}

// ── activation marker (~/.dsh/kybernos/free-llms.json) ─────────────────────
const stateFile = () => {
  const home = process.env.DSH_HOME || (process.env.HOME ? process.env.HOME + '/.dsh' : null)
  return home === null ? null : home + '/kybernos/free-llms.json'
}
const readState = async () => {
  const path = stateFile()
  if (path === null) return defaultFreeLlmState()
  try {
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : defaultFreeLlmState()
  } catch (e) { return defaultFreeLlmState() }
}
/**
 * Persist the marker, atomically (a temporary file renamed over it, like the hub's own files): a cut in the middle of the write leaves
 * the previous marker, never a truncated one. Returns whether it is on disk; callers must not tell the person it is saved when it is not.
 */
let tmpCounter = 0
const writeState = async (state) => {
  const path = stateFile()
  if (path === null) return false
  // One temporary name per call: two overlapping writes (a double click, the boot repair meeting a press) shared `.tmp-<pid>`, the second rename found
  // the file gone and reported a failure that had not happened.
  tmpCounter += 1
  const tmp = path + '.tmp-' + process.pid + '-' + tmpCounter
  try {
    const { mkdir, writeFile, rename } = await import('node:fs/promises')
    await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
    await writeFile(tmp, JSON.stringify(state, null, 2) + '\n')
    await rename(tmp, path)
    return true
  } catch (e) {
    try { const { rm } = await import('node:fs/promises'); await rm(tmp, { force: true }) } catch (e2) { /* nothing to clean */ }
    return false
  }
}

/** The loopback address of the gateway this bundle mounts: DSH's own web server, never a guessed port. */
const currentGatewayBase = (req) => {
  const server = service('webServer')
  return gatewayBase({
    serverPort: server !== null ? server.port : undefined,
    envPort: process.env.DSH_PORT,
    hostHeader: req !== undefined && req !== null && req.headers ? req.headers.host : undefined,
  })
}

/** Write or clear the `opencode-free` provider route through the settings service. */
const writeRoute = async (models, req) => {
  const svc = service('settings')
  if (svc === null || typeof svc.mutate !== 'function') return { wrote: false, reason: 'settings_absent' }
  try {
    if (Array.isArray(models) && models.length > 0) {
      const baseURL = currentGatewayBase(req)
      await svc.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', PROVIDER_ID], value: buildProfile({ models, baseURL }) }], undefined)
      // The route names OPENCODE_FREE_API_KEY and llm-pi-ai refuses the turn when it does not resolve: store the
      // free tier's marker (never over a value that is already there).
      await ensureFreeKey(service('credentials'), CREDENTIAL_REF)
      return { wrote: true, baseURL }
    }
    await svc.mutate('llm-pi-ai', [{ op: 'unset', path: ['providers', PROVIDER_ID] }], undefined)
    return { wrote: true }
  } catch (e) {
    return { wrote: false, reason: 'settings_refused' }
  }
}

/**
 * Repair a route written by an earlier version: it pointed at a port nothing listens on and its key was never stored,
 * so every chat on a free model failed. Runs once after boot; a route already on the right address is left alone.
 */
const repairWiring = async () => {
  const state = await readState()
  if (state.wired !== true) return 'not_wired'
  await ensureFreeKey(service('credentials'), CREDENTIAL_REF)
  const base = currentGatewayBase(null)
  if (routeNeedsRepair(state, base) !== true) return 'ok'
  const found = await fetchFreeModels()
  if (found.models.length === 0) return 'no_free_models'
  const route = await writeRoute(found.models, null)
  if (route.wrote !== true) return route.reason
  // The route is right now; if the marker cannot say so, report it (not a final outcome: the next attempt writes it again).
  if (await writeState({ ...(await readState()), routeBase: route.baseURL }) !== true) return 'state_not_saved'
  return 'repaired'
}

export function apply(ctx) {
  try {
    hostCtx = ctx
    ctx.inject(['webServer'], (scope) => {
      const webServer = kbFenced(scope.get('webServer'))

      // The gateway itself: OpenAI-compatible chat completions. Loops back to
      // opencode.ai with the free-tier contract applied. Served for DSH's engine,
      // not for a browser page: the engine sends no Origin and has no session, so the
      // rule is "not from another page" (notFromAnotherPage), not a cookie.
      scope.effect(() => webServer.register({ kind: 'exact', path: '/free-llms/v1/chat/completions', handler: async (req, res) => {
        if (refuseAnotherPage(req, res)) return
        if (req.method !== 'POST') { sendJson(res, 405, { error: { message: 'POST expected' } }); return }
        const body = await readBody(req)
        if (body === null || typeof body.model !== 'string') { sendJson(res, 400, { error: { message: 'model required' } }); return }
        await gatewayChat(req, res, body)
      } }), 'free-llms: gateway chat')

      // The model list, filtered to the free tier, read live from upstream.
      scope.effect(() => webServer.register({ kind: 'exact', path: '/free-llms/v1/models', handler: async (req, res) => {
        if (refuseAnotherPage(req, res)) return
        const found = await fetchFreeModels()
        sendJson(res, 200, {
          object: 'list',
          data: found.models.map((id) => ({ id, object: 'model', owned_by: 'opencode-free' })),
          _free_llms: { ok: found.ok, error: found.error },
        })
      } }), 'free-llms: gateway models')

      // Panel status: free list, wired state, and a live health probe.
      scope.effect(() => webServer.register({ kind: 'exact', path: '/free-llms/status', handler: async (req, res) => {
        if (refuseAnotherPage(req, res)) return
        const [found, state] = await Promise.all([fetchFreeModels(), readState()])
        sendJson(res, 200, {
          ok: true,
          models: found.models,
          catalogOk: found.ok,
          catalogError: found.error,
          state: publicView(state),
        })
      } }), 'free-llms: status')

      // Health probe: run the full contract against one model and classify the answer.
      // `?cached=1` (the page, on open) accepts a verdict of the last few minutes and shares one call between pages; without it
      // (« Re-check ») the call is made again. A probe of a chosen model (`?model=`) is never remembered for another.
      const probes = createProbeCache({ run: async () => {
        const found = await fetchFreeModels()
        const model = found.models[0] || null
        if (model === null) return { ok: false, code: 'no_model' }
        const probe = await healthProbe(model)
        return { ok: probe.ok, model, code: probe.code, status: probe.status }
      } })
      scope.effect(() => webServer.register({ kind: 'exact', path: '/free-llms/health', handler: async (req, res) => {
        if (refuseAnotherPage(req, res)) return
        const q = new URL(req.url || '/', 'http://localhost').searchParams
        const chosen = str(q.get('model'))
        try {
          if (chosen === null) { sendJson(res, 200, await probes.get({ fresh: q.get('cached') !== '1' })); return }
          const probe = await healthProbe(chosen)
          sendJson(res, 200, { ok: probe.ok, model: chosen, code: probe.code, status: probe.status })
        } catch (e) { sendJson(res, 200, { ok: false, code: 'error' }) }
      } }), 'free-llms: health')

      // Enable (wire the route + record the decision). Requires a same-origin POST.
      scope.effect(() => webServer.register({ kind: 'exact', path: '/free-llms/enable', handler: async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        if (sameOriginStrict(req) !== true) { sendJson(res, 403, { ok: false, error: 'origin' }); return }
        if (refuseUnsigned(req, res)) return
        const body = await readBody(req) || {}
        const acknowledged = body.acknowledged === true
        const auto = body.auto === true
        if (!acknowledged) { sendJson(res, 400, { ok: false, error: 'acknowledgement_required' }); return }
        const found = await fetchFreeModels()
        if (found.models.length === 0) { sendJson(res, 502, { ok: false, error: 'no_free_models', catalogError: found.error }); return }
        const route = await writeRoute(found.models, req)
        if (route.wrote !== true) { sendJson(res, 200, { ok: false, error: route.reason }); return }
        const state = { ...recordEnable(await readState(), { acknowledged, auto }), routeBase: route.baseURL }
        // The route is written; if the marker is not, the next boot would read « not wired » and ask for the acknowledgement again: say so.
        if (await writeState(state) !== true) { sendJson(res, 500, { ok: false, error: 'state-not-saved', routeWritten: true, state: publicView(state) }); return }
        sendJson(res, 200, { ok: true, models: found.models, state: publicView(state) })
      } }), 'free-llms: enable')

      // Disable: clear the route but keep the acknowledgement.
      scope.effect(() => webServer.register({ kind: 'exact', path: '/free-llms/disable', handler: async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        if (sameOriginStrict(req) !== true) { sendJson(res, 403, { ok: false, error: 'origin' }); return }
        if (refuseUnsigned(req, res)) return
        const route = await writeRoute([])
        const state = recordDisable(await readState())
        if (await writeState(state) !== true) { sendJson(res, 500, { ok: false, error: 'state-not-saved', routeWritten: route.wrote === true, state: publicView(state) }); return }
        sendJson(res, 200, { ok: route.wrote === true, state: publicView(state) })
      } }), 'free-llms: disable')

      // First-run auto-enable: only when the person brings no model of their own
      // AND has acknowledged the prompt-retention notice. The wizard calls this
      // after its model step; a person who already has a model is never overridden.
      scope.effect(() => webServer.register({ kind: 'exact', path: '/free-llms/auto-enable', handler: async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        if (sameOriginStrict(req) !== true) { sendJson(res, 403, { ok: false, error: 'origin' }); return }
        if (refuseUnsigned(req, res)) return
        const body = await readBody(req) || {}
        const state = await readState()
        const decision = shouldAutoEnable(state, {
          hasOwnModel: body.hasOwnModel === true,
          acknowledged: body.acknowledged === true,
        })
        if (decision !== true) {
          sendJson(res, 200, { ok: false, skipped: true, reason: body.hasOwnModel === true ? 'has_own_model' : (body.acknowledged !== true ? 'not_acknowledged' : 'already_wired') })
          return
        }
        const found = await fetchFreeModels()
        if (found.models.length === 0) { sendJson(res, 200, { ok: false, skipped: true, reason: 'no_free_models' }); return }
        const route = await writeRoute(found.models, req)
        if (route.wrote !== true) { sendJson(res, 200, { ok: false, skipped: true, reason: route.reason }); return }
        const next = { ...recordEnable(state, { acknowledged: true, auto: true }), routeBase: route.baseURL }
        if (await writeState(next) !== true) { sendJson(res, 500, { ok: false, error: 'state-not-saved', routeWritten: true, state: publicView(next) }); return }
        sendJson(res, 200, { ok: true, models: found.models, state: publicView(next) })
      } }), 'free-llms: auto-enable')

      // Shortly after boot, repair a route an earlier version wrote (wrong address, key never stored). The settings
      // and credentials services can be a moment late at boot, so a failed attempt is tried again, three times at most.
      scope.effect(() => {
        const delays = [10000, 60000, 300000]
        const final = new Set(['ok', 'repaired', 'not_wired'])
        let attempt = 0
        let timer = null
        const arm = () => {
          timer = setTimeout(() => {
            repairWiring().then((outcome) => {
              if (!final.has(outcome) && attempt < delays.length - 1) { attempt += 1; arm() }
            }).catch(() => { if (attempt < delays.length - 1) { attempt += 1; arm() } })
          }, delays[attempt])
          if (typeof timer.unref === 'function') timer.unref()
        }
        arm()
        return () => { if (timer !== null) clearTimeout(timer) }
      }, 'free-llms: repair wiring')
    })
  } catch (bootError) {
    try { console.error('[kybernos-free-llms] routes could not be mounted', bootError) } catch (e2) { /* no console */ }
  }
}
