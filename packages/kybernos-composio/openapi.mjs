// API connectors from an OpenAPI 3 spec: a spec address and one key become native tools for the agents, one per operation the person
// chose. No engine patch and no MCP server in between: the host registers the tools through the same `tools` service as the other
// native tools, and calls the API itself.
//
// What it does, and what it deliberately does not:
//   · JSON specs of OpenAPI 3.x only (a YAML or Swagger 2 spec is refused with a word the page explains);
//   · path and query parameters plus one JSON body; header and cookie parameters are ignored (the key is the only header it sets);
//   · the key is sent only to the API's own address (the base URL the person confirmed), never to the spec's address;
//   · https only (plain http for this computer's own address), no redirect is followed, a response is cut at 100 KB;
//   · the operations that change data are off until the person turns them on, and the agents' usual approval still applies.
//
// Pure functions first (tested without a network), then `createOpenapi` which owns the private store and the registered tools.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const MAX_SPEC_BYTES = 5 * 1024 * 1024
export const MAX_RESPONSE_BYTES = 100 * 1024
export const MAX_OPERATIONS = 400
export const MAX_CHOSEN = 100
export const TIMEOUT_MS = 20000
export const NAME_RE = /^[a-z0-9][a-z0-9-]{1,30}$/
const METHODS = ['get', 'post', 'put', 'patch', 'delete']
const AUTH_TYPES = ['none', 'bearer', 'header', 'query', 'basic']
const HEADER_RE = /^[A-Za-z0-9-]{1,64}$/
const HEADER_DENY = ['host', 'content-length', 'transfer-encoding', 'connection', 'cookie', 'content-type', 'accept', 'user-agent']
const PARAM_RE = /^[A-Za-z0-9_.-]{1,64}$/

const isObj = (v) => v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v)

/** The address a request may go to: https, or http for this computer itself. Returns a URL or null. */
export const safeUrl = (raw) => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000) return null
  let u
  try { u = new URL(raw) } catch (e) { return null }
  if (u.username !== '' || u.password !== '') return null
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]'
  if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return u
  return null
}

/** The spec as an object, or a word: not_json | yaml_unsupported | swagger2_unsupported | not_openapi. */
export const parseSpec = (text) => {
  const t = String(text === null || text === undefined ? '' : text).trim()
  if (t === '') return { ok: false, error: 'not_json' }
  if (t[0] !== '{') return { ok: false, error: /^(openapi|swagger|info|paths)\s*:/m.test(t) ? 'yaml_unsupported' : 'not_json' }
  let doc
  try { doc = JSON.parse(t) } catch (e) { return { ok: false, error: 'not_json' } }
  if (!isObj(doc)) return { ok: false, error: 'not_openapi' }
  if (typeof doc.swagger === 'string') return { ok: false, error: 'swagger2_unsupported' }
  if (typeof doc.openapi !== 'string' || !doc.openapi.startsWith('3') || !isObj(doc.paths)) return { ok: false, error: 'not_openapi' }
  return { ok: true, doc }
}

/** `#/components/…` pointers only, a few levels deep. null when it cannot be followed. */
const deref = (doc, node, depth = 0) => {
  if (!isObj(node) || typeof node.$ref !== 'string') return node
  if (depth > 6 || !node.$ref.startsWith('#/')) return null
  let cur = doc
  for (const part of node.$ref.slice(2).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!isObj(cur) && !Array.isArray(cur)) return null
    cur = cur[key]
    if (cur === undefined) return null
  }
  return deref(doc, cur, depth + 1)
}

const JSON_TYPES = ['string', 'integer', 'number', 'boolean', 'array', 'object']
/** A parameter's schema reduced to what a tool's JSON schema may carry here: a type, an enum, a description. */
const simpleSchema = (doc, raw, description) => {
  const s = deref(doc, raw)
  const out = { type: 'string' }
  if (isObj(s)) {
    if (JSON_TYPES.includes(s.type)) out.type = s.type
    if (Array.isArray(s.enum) && s.enum.length > 0 && s.enum.length <= 50 && s.enum.every((v) => typeof v === 'string')) out.enum = s.enum.slice()
    if (out.type === 'array') out.items = { type: isObj(s.items) && JSON_TYPES.includes(s.items.type) && s.items.type !== 'array' && s.items.type !== 'object' ? s.items.type : 'string' }
    if (out.type === 'object') { delete out.enum }
  }
  if (typeof description === 'string' && description.trim() !== '') out.description = description.trim().slice(0, 300)
  return out
}

const slug = (s) => String(s).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50)

/**
 * Every operation of the spec: { id, method, path, summary, write, params:[{name,in,required,schema}], body: null | { description, required } }.
 * `write` is anything that is not a GET. At most MAX_OPERATIONS; ids are unique.
 */
export const operationsOf = (doc) => {
  const out = []
  const seen = new Set()
  for (const path of Object.keys(doc.paths)) {
    const item = deref(doc, doc.paths[path])
    if (!isObj(item) || typeof path !== 'string' || !path.startsWith('/')) continue
    for (const method of METHODS) {
      const op = deref(doc, item[method])
      if (!isObj(op)) continue
      if (out.length >= MAX_OPERATIONS) return out
      let id = typeof op.operationId === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(op.operationId) ? op.operationId.replace(/[.-]/g, '_') : slug(method + '_' + path)
      if (id === '') id = method + '_' + (out.length + 1)
      let n = 2
      const base = id
      while (seen.has(id)) { id = base + '_' + n; n += 1 }
      seen.add(id)
      const params = []
      const names = new Set()
      for (const raw of [].concat(Array.isArray(item.parameters) ? item.parameters : [], Array.isArray(op.parameters) ? op.parameters : [])) {
        const p = deref(doc, raw)
        if (!isObj(p) || (p.in !== 'path' && p.in !== 'query') || typeof p.name !== 'string' || !PARAM_RE.test(p.name)) continue
        const key = p.in + ':' + p.name
        if (names.has(key)) { const at = params.findIndex((x) => x.in === p.in && x.name === p.name); if (at >= 0) params.splice(at, 1) }
        names.add(key)
        params.push({ name: p.name, in: p.in, required: p.in === 'path' || p.required === true, schema: simpleSchema(doc, p.schema, p.description) })
      }
      let body = null
      const rb = deref(doc, op.requestBody)
      if (isObj(rb) && isObj(rb.content) && isObj(rb.content['application/json'])) {
        body = { description: typeof rb.description === 'string' ? rb.description.trim().slice(0, 300) : '', required: rb.required === true }
      }
      const summary = (typeof op.summary === 'string' && op.summary.trim() !== '' ? op.summary : (typeof op.description === 'string' ? op.description : '')).trim().slice(0, 200)
      out.push({ id, method: method.toUpperCase(), path, summary, write: method !== 'get', params, body })
    }
  }
  return out
}

/** The base address of the API: the spec's first usable server (a relative one resolves against the spec's own address), or null. */
export const baseUrlOf = (doc, specUrl) => {
  for (const s of Array.isArray(doc.servers) ? doc.servers : []) {
    if (!isObj(s) || typeof s.url !== 'string') continue
    let raw = s.url.trim()
    if (isObj(s.variables)) raw = raw.replace(/\{([^}]+)\}/g, (m, k) => (isObj(s.variables[k]) && typeof s.variables[k].default === 'string' ? s.variables[k].default : m))
    if (/\{[^}]+\}/.test(raw)) continue
    try {
      const ok = safeUrl(new URL(raw, specUrl).href)
      if (ok !== null) return ok.href.replace(/\/+$/, '')
    } catch (e) { /* the next server */ }
  }
  return null
}

const authOf = (raw) => {
  const a = isObj(raw) ? raw : {}
  const type = AUTH_TYPES.includes(a.type) ? a.type : 'none'
  if ((type === 'header' || type === 'query') && !(type === 'header' ? HEADER_RE : PARAM_RE).test(String(a.name))) return null
  if (type === 'header' && HEADER_DENY.includes(String(a.name).toLowerCase())) return null
  return type === 'header' || type === 'query' ? { type, name: String(a.name) } : { type }
}
export { authOf }

/** What goes on the wire for one call: { url, init }. `args` is what the agent sent; missing required parameters give { error }. */
export const buildRequest = (connector, op, args) => {
  const a = isObj(args) ? args : {}
  let path = op.path
  for (const p of op.params.filter((x) => x.in === 'path')) {
    const v = a[p.name]
    if (v === undefined || v === null || String(v) === '') return { error: 'missing_parameter', name: p.name }
    path = path.split('{' + p.name + '}').join(encodeURIComponent(String(v)))
  }
  if (/\{[^}]+\}/.test(path)) return { error: 'missing_parameter', name: (/\{([^}]+)\}/.exec(path) || [])[1] }
  const url = new URL(connector.baseUrl + path)
  for (const p of op.params.filter((x) => x.in === 'query')) {
    const v = a[p.name]
    if (v === undefined || v === null) { if (p.required) return { error: 'missing_parameter', name: p.name }; continue }
    url.searchParams.set(p.name, Array.isArray(v) ? v.join(',') : (typeof v === 'object' ? JSON.stringify(v) : String(v)))
  }
  const headers = { accept: 'application/json, text/plain;q=0.9, */*;q=0.5', 'user-agent': 'kybernos-openapi' }
  const auth = authOf(connector.auth) || { type: 'none' }
  const key = typeof connector.key === 'string' ? connector.key : ''
  if (key !== '') {
    if (auth.type === 'bearer') headers.authorization = 'Bearer ' + key
    else if (auth.type === 'basic') headers.authorization = 'Basic ' + Buffer.from(key).toString('base64')
    else if (auth.type === 'header') headers[auth.name.toLowerCase()] = key
    else if (auth.type === 'query') url.searchParams.set(auth.name, key)
  }
  const init = { method: op.method, headers, redirect: 'manual' }
  if (op.body !== null && op.method !== 'GET' && a.body !== undefined) {
    const text = JSON.stringify(a.body)
    if (text.length > 256 * 1024) return { error: 'body_too_large' }
    headers['content-type'] = 'application/json'
    init.body = text
  } else if (op.body !== null && op.body.required === true && op.method !== 'GET') return { error: 'missing_parameter', name: 'body' }
  return { url: url.href, init }
}

const readBounded = async (res, max) => {
  const reader = res.body !== null && res.body !== undefined && typeof res.body.getReader === 'function' ? res.body.getReader() : null
  if (reader === null) { const t = await res.text(); return { text: t.slice(0, max), cut: t.length > max } }
  const chunks = []
  let size = 0
  let cut = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) { chunks.push(value.slice(0, value.length - (size - max))); cut = true; try { await reader.cancel() } catch (e) { /* gone */ } break }
    chunks.push(value)
  }
  return { text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'), cut }
}

/** One call. Never throws: { ok, status, text, cut } or { ok:false, error }. A key is never part of what comes back. */
export const callOperation = async ({ connector, op, args, fetchFn = fetch, timeoutMs = TIMEOUT_MS }) => {
  const req = buildRequest(connector, op, args)
  if (req.error !== undefined) return { ok: false, error: req.error, name: req.name }
  const target = safeUrl(req.url)
  const base = safeUrl(connector.baseUrl)
  if (target === null || base === null || target.origin !== base.origin) return { ok: false, error: 'bad_address' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchFn(req.url, Object.assign({}, req.init, { signal: controller.signal }))
    if (res.status >= 300 && res.status < 400) return { ok: false, error: 'redirect', status: res.status }
    const { text, cut } = await readBounded(res, MAX_RESPONSE_BYTES)
    return { ok: res.status >= 200 && res.status < 300, status: res.status, text, cut }
  } catch (e) {
    return { ok: false, error: e !== null && e !== undefined && e.name === 'AbortError' ? 'timeout' : 'network' }
  } finally { clearTimeout(timer) }
}

/** The text an agent reads back from a call. */
export const resultText = (r) => {
  if (r.ok === true) return 'HTTP ' + r.status + '\n' + (r.text === '' ? '(empty)' : r.text) + (r.cut ? '\n[cut at ' + Math.round(MAX_RESPONSE_BYTES / 1024) + ' KB]' : '')
  if (r.status !== undefined) return 'HTTP ' + r.status + (r.text ? '\n' + r.text : '') + (r.error === 'redirect' ? ' (a redirect is not followed)' : '')
  const says = { missing_parameter: 'missing parameter ' + String(r.name), body_too_large: 'the body is too large', bad_address: 'the address is not allowed', timeout: 'the API did not answer in time', network: 'the API could not be reached' }
  return 'The call failed: ' + (says[r.error] || String(r.error))
}

/** The native tool for one chosen operation. `execute(args)` answers { ok, text }. */
export const toolFor = (connector, op, { fetchFn = fetch } = {}) => {
  const properties = {}
  const required = []
  for (const p of op.params) {
    const key = properties[p.name] === undefined ? p.name : p.in + '_' + p.name
    properties[key] = p.schema
    if (p.required) required.push(key)
  }
  if (op.body !== null && op.method !== 'GET') {
    properties.body = { type: 'object', description: (op.body.description !== '' ? op.body.description + ' ' : '') + 'The JSON request body.' }
    if (op.body.required) required.push('body')
  }
  const host = new URL(connector.baseUrl).host
  const name = ('api_' + connector.name.replace(/-/g, '_') + '_' + op.id).slice(0, 64)
  const description = ((op.write ? 'Changes data. ' : '') + (op.summary !== '' ? op.summary + '. ' : '') + op.method + ' ' + op.path + ' on ' + host + ' (the ' + connector.title + ' API).').slice(0, 480)
  return {
    name,
    description,
    parameters: Object.assign({ type: 'object', additionalProperties: false, properties }, required.length > 0 ? { required } : {}),
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, text: { type: 'string' } }, required: ['ok'] },
      render: (args, value) => [{ type: 'text', text: typeof value.text === 'string' ? value.text : '' }],
    },
    async execute(args) {
      const r = await callOperation({ connector, op, args, fetchFn })
      return { ok: r.ok === true, text: resultText(r) }
    },
  }
}

// ── the private store and the registered tools ───────────────────────────────────────────────────────────────

const storePath = (home) => join(home, 'kybernos', 'openapi-connectors.json')

const readStore = (home) => {
  try {
    const v = JSON.parse(readFileSync(storePath(home), 'utf8'))
    return v !== null && typeof v === 'object' && isObj(v.items) ? v : { v: 1, items: {} }
  } catch (e) { return { v: 1, items: {} } }
}

const writeStore = (home, store) => {
  const file = storePath(home)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid
  writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 })
  try { chmodSync(tmp, 0o600) } catch (e) { /* best effort */ }
  renameSync(tmp, file)
}

/**
 * @param {{ home: string, fetchFn?: typeof fetch, log?: (m: string) => void }} deps
 * Every method answers { ok, … } or { ok:false, error: <word> } and never throws.
 */
export const createOpenapi = ({ home, fetchFn = fetch, log = () => {} }) => {
  let tools = null
  const live = new Map()

  // The spec is fetched anonymously: the key belongs to the API and is never sent to wherever the spec happens to be hosted.
  const fetchSpec = async (url, auth) => {
    const u = safeUrl(url)
    if (u === null) return { ok: false, error: 'bad_address' }
    if (authOf(auth) === null) return { ok: false, error: 'bad_auth' }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetchFn(u.href, { headers: { accept: 'application/json', 'user-agent': 'kybernos-openapi' }, redirect: 'follow', signal: controller.signal })
      if (!res.ok) return { ok: false, error: res.status === 401 || res.status === 403 ? 'spec_unauthorized' : 'spec_http', status: res.status }
      const { text, cut } = await readBounded(res, MAX_SPEC_BYTES)
      if (cut) return { ok: false, error: 'spec_too_large' }
      return { ok: true, text, url: u.href }
    } catch (e) { return { ok: false, error: e !== null && e !== undefined && e.name === 'AbortError' ? 'timeout' : 'network' } } finally { clearTimeout(timer) }
  }

  /** Step 1: what the spec offers, nothing is kept. */
  const read = async ({ url, auth }) => {
    const got = await fetchSpec(url, auth)
    if (got.ok !== true) return got
    const parsed = parseSpec(got.text)
    if (parsed.ok !== true) return parsed
    const ops = operationsOf(parsed.doc)
    if (ops.length === 0) return { ok: false, error: 'no_operations' }
    const info = isObj(parsed.doc.info) ? parsed.doc.info : {}
    return {
      ok: true,
      title: typeof info.title === 'string' && info.title.trim() !== '' ? info.title.trim().slice(0, 80) : new URL(got.url).hostname,
      version: typeof info.version === 'string' ? info.version.slice(0, 30) : '',
      baseUrl: baseUrlOf(parsed.doc, got.url),
      total: ops.length,
      operations: ops.map((o) => ({ id: o.id, method: o.method, path: o.path, summary: o.summary, write: o.write })),
    }
  }

  const connectorOf = (name, item) => ({ name, title: item.title, baseUrl: item.baseUrl, auth: item.auth, key: item.key })

  const dropAll = () => { for (const d of live.values()) { try { d() } catch (e) { /* gone with its scope */ } } live.clear() }

  /** Registers what the store holds that is not registered yet, and removes what it no longer holds. */
  const sync = () => {
    if (tools === null) return
    const store = readStore(home)
    const wanted = new Map()
    for (const [name, item] of Object.entries(store.items)) {
      if (!NAME_RE.test(name) || !isObj(item) || safeUrl(item.baseUrl) === null || !Array.isArray(item.operations)) continue
      for (const op of item.operations) {
        try { const def = toolFor(connectorOf(name, item), op, { fetchFn }); wanted.set(def.name, def) } catch (e) { /* a malformed operation is skipped */ }
      }
    }
    for (const [n, dispose] of Array.from(live.entries())) if (!wanted.has(n)) { try { dispose() } catch (e) { /* gone */ } live.delete(n) }
    for (const [n, def] of wanted) {
      if (live.has(n)) continue
      try { live.set(n, tools.register(def)) } catch (e) { log('tool ' + n + ': ' + String((e && e.message) || e)) }
    }
  }

  const attach = (service) => { dropAll(); tools = service; sync() }
  const detach = () => { dropAll(); tools = null }

  /** Step 2: re-reads the spec (the page's list is never trusted), keeps the chosen operations, registers their tools. */
  const add = async ({ name, url, baseUrl, auth, key, operations }) => {
    if (typeof name !== 'string' || !NAME_RE.test(name)) return { ok: false, error: 'bad_name' }
    const a = authOf(auth)
    if (a === null) return { ok: false, error: 'bad_auth' }
    if (!Array.isArray(operations) || operations.length === 0 || operations.length > MAX_CHOSEN || !operations.every((x) => typeof x === 'string')) return { ok: false, error: 'bad_operations' }
    const got = await fetchSpec(url, a)
    if (got.ok !== true) return got
    const parsed = parseSpec(got.text)
    if (parsed.ok !== true) return parsed
    const base = safeUrl(typeof baseUrl === 'string' && baseUrl !== '' ? baseUrl : baseUrlOf(parsed.doc, got.url))
    if (base === null) return { ok: false, error: 'no_base_url' }
    const all = operationsOf(parsed.doc)
    const chosen = all.filter((o) => operations.includes(o.id))
    if (chosen.length === 0) return { ok: false, error: 'bad_operations' }
    const store = readStore(home)
    const info = isObj(parsed.doc.info) ? parsed.doc.info : {}
    store.items[name] = {
      title: typeof info.title === 'string' && info.title.trim() !== '' ? info.title.trim().slice(0, 80) : base.hostname,
      specUrl: got.url,
      baseUrl: base.href.replace(/\/+$/, ''),
      auth: a,
      key: typeof key === 'string' ? key.trim() : '',
      operations: chosen,
      createdAt: new Date().toISOString(),
    }
    try { writeStore(home, store) } catch (e) { return { ok: false, error: 'store_write_failed' } }
    sync()
    return { ok: true, name, tools: chosen.map((o) => toolFor(connectorOf(name, store.items[name]), o).name) }
  }

  const list = () => {
    const store = readStore(home)
    return {
      ok: true,
      items: Object.entries(store.items).filter(([n, i]) => NAME_RE.test(n) && isObj(i)).map(([name, i]) => ({
        name,
        title: String(i.title || name),
        host: (() => { try { return new URL(i.baseUrl).host } catch (e) { return '' } })(),
        auth: isObj(i.auth) ? i.auth.type : 'none',
        hasKey: typeof i.key === 'string' && i.key !== '',
        operations: (Array.isArray(i.operations) ? i.operations : []).map((o) => ({ id: o.id, method: o.method, path: o.path, write: o.write === true })),
        live: (Array.isArray(i.operations) ? i.operations : []).filter((o) => live.has(('api_' + name.replace(/-/g, '_') + '_' + o.id).slice(0, 64))).length,
      })),
    }
  }

  const remove = ({ name }) => {
    if (typeof name !== 'string' || !NAME_RE.test(name)) return { ok: false, error: 'bad_name' }
    const store = readStore(home)
    if (store.items[name] === undefined) return { ok: false, error: 'not_found' }
    delete store.items[name]
    try { writeStore(home, store) } catch (e) { return { ok: false, error: 'store_write_failed' } }
    sync()
    return { ok: true }
  }

  /** Runs one READ operation of a saved connector, so the page can say « it works ». Writes are never run from here. */
  const test = async ({ name, operationId, args }) => {
    if (typeof name !== 'string' || !NAME_RE.test(name)) return { ok: false, error: 'bad_name' }
    const item = readStore(home).items[name]
    if (!isObj(item)) return { ok: false, error: 'not_found' }
    const op = (Array.isArray(item.operations) ? item.operations : []).find((o) => o.id === operationId)
    if (op === undefined) return { ok: false, error: 'bad_operations' }
    if (op.write === true || op.method !== 'GET') return { ok: false, error: 'write_not_tested' }
    const r = await callOperation({ connector: connectorOf(name, item), op, args: isObj(args) ? args : {}, fetchFn })
    return { ok: true, reached: r.ok === true, status: r.status, text: r.ok === true ? r.text.slice(0, 2000) : resultText(r).slice(0, 500) }
  }

  return { read, add, list, remove, test, sync, attach, detach, tools: () => Array.from(live.keys()) }
}
