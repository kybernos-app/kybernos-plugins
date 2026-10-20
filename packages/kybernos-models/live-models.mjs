// What does this provider serve, right now? One read-only request to the provider's own model list.
//
// « Fetch available models » used to ask the engine (`llm.discoverModels`). For a provider the engine ships a catalog of, the
// engine answers from that catalog and never touches the network (measured on DSH 0.2.1-rc.2: `discoverModels` returns the catalog
// whenever `catalogModels(provider)` is not empty): a model the provider added yesterday never showed up, and the catalog itself
// only holds one protocol's models per provider. This module asks the endpoint instead, from the host, with the key the profile
// names. No engine patch: it is a plugin route (`POST /kybernos-models/models/live`, mounted by index.js).
//
// Rules, all of them tested (test-live-models.mjs), the same as key-check.mjs:
//  - the key goes to the address the host resolved (the profile's `baseURL`, else the catalogue's), or to the one the page typed
//    next to a key it typed too; never to an address read from anywhere else;
//  - an address must be https, or http on this machine; no user:password in it;
//  - a redirect is refused: a provider that answers with one does not get the key forwarded;
//  - the answer is read with a ceiling on the bytes actually received, and only the model list comes back: never the key, never
//    the provider's raw body;
//  - global fetch, bounded by a timeout. A background request of ours must never go through the engine's web.fetch
//    (see test-no-engine-fetch.mjs).

/** The protocols whose listing this build can read (the engine's own set). */
export const LISTABLE_PROTOCOLS = ['anthropic-messages', 'openai-completions', 'openai-responses']
const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_LIMIT = 1000
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_MODELS = 5000
const MAX_ID = 300
const TIMEOUT_MS = 15000
const LOOPBACK = /^(localhost|127(\.\d+){3}|\[::1\])$/i
// Printable ASCII, no space: what every provider's keys are made of, and nothing that could split a header.
const KEY_RE = /^[\x21-\x7e]{8,400}$/
const REF_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Where a model list may be asked: https anywhere, http on this machine only, no credentials in the address. Pure. */
export const endpointOk = (value) => {
  let u
  try { u = new URL(String(value)) } catch (e) { return false }
  if (u.username !== '' || u.password !== '' || u.hash !== '') return false
  return u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.test(u.hostname))
}

/** The protocol a request speaks: the one named, else Anthropic's for Anthropic's own host, else the OpenAI-compatible one. Pure. */
export const pickApi = (api, baseURL) => {
  if (typeof api === 'string' && api !== '') return api
  try { if (new URL(String(baseURL)).hostname === 'api.anthropic.com') return 'anthropic-messages' } catch (e) { /* no address */ }
  return 'openai-completions'
}

/**
 * The list address of an endpoint. The base is a prefix (a deployment path keeps its segments); OpenAI protocols list at
 * `{base}/models`, Anthropic at `{root}/v1/models` where the root is the base without one trailing `/v1`. Same reading as the
 * engine's `listingUrl`. Pure.
 */
export const listingUrl = (baseURL, api) => {
  const base = String(baseURL).replace(/\/+$/, '')
  if (api !== 'anthropic-messages') return base + '/models'
  return (base.endsWith('/v1') ? base.slice(0, -3) : base) + '/v1/models?limit=' + String(ANTHROPIC_LIMIT)
}

const capacity = (...c) => { for (const x of c) if (typeof x === 'number' && Number.isInteger(x) && x > 0) return x; return undefined }
const label = (...c) => { for (const x of c) if (typeof x === 'string' && x.trim() !== '') return x.trim(); return undefined }
const modalities = (...c) => {
  for (const x of c) {
    if (!Array.isArray(x)) continue
    const ok = x.filter((s) => s === 'text' || s === 'image')
    if (ok.length > 0) return ok.filter((s, i) => ok.indexOf(s) === i)
  }
  return undefined
}

/**
 * The models of one listing reply, in endpoint order: the standard `data` array wins over an enriched `models` map (whose property
 * keys are the ids the endpoint accepts). An entry with no usable id is skipped, a duplicate keeps its first. `null` when the reply
 * is neither shape (the endpoint has no model list to read). Pure.
 * @returns {Array<{id:string,name:string,contextWindow?:number,maxTokens?:number,inputModalities?:string[]}>|null}
 */
export const readListing = (body) => {
  if (!isObj(body)) return null
  let listed
  if (Array.isArray(body.data)) listed = body.data.map((raw) => ({ raw }))
  else if (isObj(body.models)) listed = Object.keys(body.models).filter((k) => isObj(body.models[k])).map((k) => ({ key: k, raw: body.models[k] }))
  else return null
  const seen = new Set()
  const out = []
  for (const { key, raw } of listed) {
    const e = isObj(raw) ? raw : {}
    const id = label(key, e.id)
    if (id === undefined || id.length > MAX_ID || seen.has(id)) continue
    seen.add(id)
    const one = { id, name: label(e.name, e.display_name, e.displayName) || id }
    const contextWindow = capacity(e.contextWindow, e.context_window, e.context_length, e.max_input_tokens, isObj(e.limit) ? e.limit.context : undefined)
    const maxTokens = capacity(e.maxOutputTokens, e.max_output_tokens, e.maxTokens, e.max_tokens, isObj(e.limit) ? e.limit.output : undefined, isObj(e.top_provider) ? e.top_provider.max_completion_tokens : undefined)
    const input = modalities(e.inputModalities, e.input_modalities, isObj(e.architecture) ? e.architecture.input_modalities : undefined, isObj(e.modalities) ? e.modalities.input : undefined)
    if (contextWindow !== undefined) one.contextWindow = contextWindow
    if (maxTokens !== undefined) one.maxTokens = maxTokens
    if (input !== undefined) one.inputModalities = input
    out.push(one)
    if (out.length >= MAX_MODELS) break
  }
  return out
}

/** The request headers: the profile's own, then the protocol's auth. A header the profile holds cannot override the key. Pure. */
export const requestHeaders = (api, key, extra) => {
  const h = { accept: 'application/json' }
  if (isObj(extra)) for (const k of Object.keys(extra)) if (typeof extra[k] === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(k)) h[k.toLowerCase()] = extra[k]
  if (typeof key === 'string' && key !== '') {
    if (api === 'anthropic-messages') { h['anthropic-version'] = ANTHROPIC_VERSION; h['x-api-key'] = key } else h.authorization = 'Bearer ' + key
  }
  return h
}

/** The profile of a route in the `llm-pi-ai` settings, however the host's settings service words its answer. Never throws. */
export const profileOf = async (settings, route) => {
  try {
    if (settings === null || settings === undefined || typeof settings.describe !== 'function') return null
    let shapes = await settings.describe()
    if (isObj(shapes) && isObj(shapes.value) && Array.isArray(shapes.value.namespaces)) shapes = shapes.value.namespaces
    if (!Array.isArray(shapes)) return null
    const f = shapes.find((x) => isObj(x) && x.ns === 'llm-pi-ai')
    const providers = f !== undefined && isObj(f.value) && isObj(f.value.providers) ? f.value.providers : null
    return providers !== null && isObj(providers[route]) ? providers[route] : null
  } catch (e) { return null }
}

/**
 * Where to ask and with what. The profile (the saved truth) wins over the catalogue; the page's own address is used only when it
 * comes with a key the page typed — the person typed both, so the key goes where the person said.
 * @param {{route:string,baseURL?:string,api?:string,key?:string}} req
 * @param {object|null} profile  the route's saved profile
 * @param {{url?:string,env?:string}|null} entry  the route's catalogue entry
 * @returns {{ok:true,baseURL:string,api:string,keyRef:string|null,typedKey:string|null,headers:object|null}|{ok:false,error:string}}
 */
export const resolveTarget = (req, profile, entry) => {
  const typedKey = typeof req.key === 'string' && req.key.trim() !== '' ? req.key.trim() : null
  if (typedKey !== null && KEY_RE.test(typedKey) !== true) return { ok: false, error: 'bad-key' }
  const typedUrl = typeof req.baseURL === 'string' && req.baseURL.trim() !== '' ? req.baseURL.trim() : null
  const saved = isObj(profile) && typeof profile.baseURL === 'string' && profile.baseURL !== '' ? profile.baseURL : (isObj(entry) && typeof entry.url === 'string' ? entry.url : '')
  const trim = (u) => String(u).replace(/\/+$/, '')
  // An address the person changed, with no key typed beside it: the saved key must not follow it to a new host. The page falls back to the engine.
  if (typedUrl !== null && typedKey === null && saved !== '' && trim(typedUrl) !== trim(saved)) return { ok: false, error: 'foreign-endpoint' }
  const baseURL = typedUrl !== null && typedKey !== null ? typedUrl : saved
  if (baseURL === '') return { ok: false, error: 'no-endpoint' }
  if (endpointOk(baseURL) !== true) return { ok: false, error: 'bad-endpoint' }
  const api = pickApi(typedUrl !== null && typedKey !== null && typeof req.api === 'string' ? req.api : (isObj(profile) ? profile.api : undefined), baseURL)
  if (LISTABLE_PROTOCOLS.indexOf(api) < 0) return { ok: false, error: 'unsupported-protocol' }
  const named = isObj(profile) && typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv !== '' ? profile.apiKeyEnv : (isObj(entry) && typeof entry.env === 'string' ? entry.env : '')
  return { ok: true, baseURL, api, keyRef: REF_RE.test(named) ? named : null, typedKey, headers: isObj(profile) && isObj(profile.headers) ? profile.headers : null }
}

/** The key of a reference through the host's credentials service, or null. Never throws, never logs. */
export const keyFor = async (credentials, ref) => {
  try {
    if (ref === null || credentials === null || credentials === undefined || typeof credentials.resolve !== 'function') return null
    const hit = await credentials.resolve(ref)
    const v = hit !== null && typeof hit === 'object' ? hit.value : null
    return typeof v === 'string' && KEY_RE.test(v.trim()) ? v.trim() : null
  } catch (e) { return null }
}

const readCapped = async (res) => {
  const declared = Number(res.headers !== undefined && res.headers !== null && typeof res.headers.get === 'function' ? res.headers.get('content-length') : NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) { try { await res.body.cancel() } catch (e) { /* closed */ } return null }
  if (res.body === null || res.body === undefined || typeof res.body.getReader !== 'function') return typeof res.text === 'function' ? (await res.text()).slice(0, MAX_RESPONSE_BYTES) : ''
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) return null
      chunks.push(value)
    }
  } finally { try { await reader.cancel() } catch (e) { /* settled */ } }
  return new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))))
}

/** The provider's own words about a refusal: the `error.message` of an error envelope, short and on one line. */
const reasonOf = (text) => {
  try {
    const b = JSON.parse(text)
    const m = isObj(b) && isObj(b.error) ? b.error.message : (isObj(b) ? b.message : undefined)
    return typeof m === 'string' ? m.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
  } catch (e) { return '' }
}

/**
 * Ask the endpoint. Never throws.
 * @returns {Promise<{ok:true,models:object[],url:string}|{ok:false,error:'unreachable'|'refused'|'too-big'|'bad-reply',status?:number,detail?:string}>}
 */
export const fetchLive = async ({ baseURL, api, key, headers, fetch: doFetch, timeoutMs }) => {
  const url = listingUrl(baseURL, api)
  const f = typeof doFetch === 'function' ? doFetch : globalThis.fetch
  let res
  try {
    res = await f(url, { method: 'GET', headers: requestHeaders(api, key, headers), redirect: 'error', signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : TIMEOUT_MS) })
  } catch (e) { return { ok: false, error: 'unreachable' } }
  let text
  try { text = await readCapped(res) } catch (e) { return { ok: false, error: 'unreachable' } }
  if (text === null) return { ok: false, error: 'too-big' }
  if (res.status < 200 || res.status >= 300) return { ok: false, error: 'refused', status: res.status, detail: reasonOf(text) }
  let body
  try { body = JSON.parse(text) } catch (e) { return { ok: false, error: 'bad-reply' } }
  const models = readListing(body)
  return models === null ? { ok: false, error: 'bad-reply' } : { ok: true, models, url }
}

/**
 * The whole answer of the route, for one request: resolve, ask, and say one of `ok` / a refusal. The services are the host's
 * (`settings`, `credentials`); either may be missing, and the answer then says what it could not do.
 * @param {{route:string,baseURL?:string,api?:string,key?:string}} req
 * @param {{settings?:object,credentials?:object,entry?:object|null,fetch?:Function,timeoutMs?:number}} ctx
 */
export const liveModels = async (req, ctx = {}) => {
  const route = typeof req.route === 'string' ? req.route : ''
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(route) !== true) return { ok: false, error: 'bad-route' }
  const profile = await profileOf(ctx.settings, route)
  const target = resolveTarget(req, profile, ctx.entry === undefined ? null : ctx.entry)
  if (target.ok !== true) return target
  const key = target.typedKey !== null ? target.typedKey : await keyFor(ctx.credentials, target.keyRef)
  return fetchLive({ baseURL: target.baseURL, api: target.api, key, headers: target.headers, fetch: ctx.fetch, timeoutMs: ctx.timeoutMs })
}


// ── Which protocol does a model speak? ─────────────────────────────────────────────────────────────────────────────────────────
// The engine takes ONE `api` and ONE `baseURL` per route and none per model, and a model its catalog does not describe has neither:
// such a model lives in a route of its own (a « companion » of the provider). Its protocol is asked of the provider, with the key the
// provider's profile names: one request of a single token per protocol, until one answers. The key never leaves the host and nothing
// of the answers comes back but a word and the protocol that worked.
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,150}$/
const stripV1 = (base) => String(base).replace(/\/+$/, '').replace(/\/v1$/, '')

/** The protocols tried, in this order: OpenAI chat (what most models speak), Anthropic messages, OpenAI responses. Pure. */
export const PROBES = [
  { api: 'openai-completions', url: (base) => String(base).replace(/\/+$/, '') + '/chat/completions', body: (model) => ({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }) },
  { api: 'anthropic-messages', url: (base) => stripV1(base) + '/v1/messages', body: (model) => ({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }) },
  { api: 'openai-responses', url: (base) => String(base).replace(/\/+$/, '') + '/responses', body: (model) => ({ model, input: 'hi', max_output_tokens: 16 }) },
]

/** The address a route of this protocol is declared with: Anthropic's is the root (the SDK appends /v1/messages), the others keep their /v1. Pure. */
export const baseFor = (api, base) => (api === 'anthropic-messages' ? stripV1(base) : String(base).replace(/\/+$/, ''))

/**
 * Ask the provider, one protocol after the other, which one the model answers on. A 2xx is the answer; 401/403/429 and a network failure
 * stop the search (they say nothing about the protocol); any other refusal (the endpoint or the model is not for this protocol) goes on.
 * Never throws.
 * @returns {Promise<{ok:true,api:string,baseURL:string}|{ok:false,error:'refused'|'rate-limited'|'unreachable'|'unknown-protocol',status?:number}>}
 */
export const probeProtocol = async ({ baseURL, model, key, headers, fetch: doFetch, timeoutMs }) => {
  if (typeof model !== 'string' || MODEL_RE.test(model) !== true) return { ok: false, error: 'bad-model' }
  const f = typeof doFetch === 'function' ? doFetch : globalThis.fetch
  let last = 0
  for (const probe of PROBES) {
    let res
    try {
      res = await f(probe.url(baseURL), {
        method: 'POST',
        headers: { ...requestHeaders(probe.api, key, headers), 'content-type': 'application/json' },
        body: JSON.stringify(probe.body(model)),
        redirect: 'error',
        signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : TIMEOUT_MS),
      })
    } catch (e) { return { ok: false, error: 'unreachable' } }
    try { if (res.body !== null && res.body !== undefined && typeof res.body.cancel === 'function') await res.body.cancel() } catch (e) { /* closed */ }
    last = res.status
    if (res.status >= 200 && res.status < 300) return { ok: true, api: probe.api, baseURL: baseFor(probe.api, baseURL) }
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'refused', status: res.status }
    if (res.status === 429) return { ok: false, error: 'rate-limited', status: 429 }
  }
  return { ok: false, error: 'unknown-protocol', status: last }
}

/**
 * The whole answer of the probe route: resolve the provider's address and key (the saved profile, else the catalogue), then probe.
 * @param {{route:string,model:string}} req
 * @param {{settings?:object,credentials?:object,entry?:object|null,fetch?:Function,timeoutMs?:number}} ctx
 */
export const probeModel = async (req, ctx = {}) => {
  const route = typeof req.route === 'string' ? req.route : ''
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(route) !== true) return { ok: false, error: 'bad-route' }
  if (typeof req.model !== 'string' || MODEL_RE.test(req.model) !== true) return { ok: false, error: 'bad-model' }
  const profile = await profileOf(ctx.settings, route)
  const target = resolveTarget({ route }, profile, ctx.entry === undefined ? null : ctx.entry)
  if (target.ok !== true) return target
  const key = await keyFor(ctx.credentials, target.keyRef)
  return probeProtocol({ baseURL: target.baseURL, model: req.model, key, headers: target.headers, fetch: ctx.fetch, timeoutMs: ctx.timeoutMs })
}
