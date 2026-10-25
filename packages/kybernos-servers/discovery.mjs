// Discovery: from ONE address typed by the user to a server profile, by reading `/.well-known/kybernos-server.json`.
//
// The contract a Kybernos server serves (docs/dev/servers.md, « The discovery document »; the server's own builder is
// `src/modules/platform/discovery.ts`):
//   { "schema": 1, "name": "Acme Corp", "version": "1.4.0", "dsh_min": "0.1.6",
//     "api": "https://kb.acme.corp", "web": "…", "console": "…",
//     "services": { "llm": "https://…" | false, "connections": "https://…" | false } }
//   `api` is required, the rest is optional (the open half derives web and console from api).
//
// Pure: the network is injected (`fetch`), nothing is read from disk. Three steps, each reported on its own so the screen can say where it
// stopped: the server answers, it publishes a profile we understand, it is compatible with this DSH. The address typed is where the profile is
// read; the addresses INSIDE the profile are where the account's token will go, so the page shows them before anything is added.
export const WELL_KNOWN = '/.well-known/kybernos-server.json'
export const MAX_BYTES = 64 * 1024
export const MAX_ADDRESS = 300
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** The host part of what was typed, before any port or path: « localhost:8791/x » → « localhost », « [::1]:8791 » → « [::1] ». */
const hostPart = (raw) => (raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.split(/[/:?#]/)[0]).toLowerCase()

/** « kb.acme.corp » → https://kb.acme.corp ; a bare loopback host (« localhost:8791 ») → http, since a local server rarely has a certificate;
 *  a full URL keeps its scheme and its path. https always, http for loopback only; no credentials, query or fragment. */
export const parseAddress = (input) => {
  if (typeof input !== 'string') return { ok: false, error: 'bad_address' }
  let raw = input.trim()
  if (raw === '' || raw.length > MAX_ADDRESS) return { ok: false, error: 'bad_address' }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
  // « host », « host:port » and « host/path » carry no scheme; « javascript:… » or « mailto:… » do, and are judged below, never completed.
  if (hasScheme !== true && (/^[a-z0-9.\-[\]]+(:\d+)?([/?#]|$)/i.test(raw) || /^\[[0-9a-f:]+\](:\d+)?([/?#]|$)/i.test(raw))) raw = (LOOPBACK.has(hostPart(raw)) ? 'http://' : 'https://') + raw
  let u = null
  try { u = new URL(raw) } catch (e) { return { ok: false, error: 'bad_address' } }
  if (u.username !== '' || u.password !== '' || u.search !== '' || u.hash !== '') return { ok: false, error: 'bad_address' }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname))) return { ok: false, error: 'insecure_address' }
  return { ok: true, base: u.origin + u.pathname.replace(/\/+$/, ''), host: u.host }
}

const segments = (v) => String(v).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : 0))
/** -1, 0, 1: segment by segment, numeric (0.1.10 is later than 0.1.7). Anything after a hyphen is ignored. */
export const compareVersions = (a, b) => {
  const x = segments(String(a).split('-')[0]); const y = segments(String(b).split('-')[0])
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) { const d = (x[i] || 0) - (y[i] || 0); if (d !== 0) return d < 0 ? -1 : 1 }
  return 0
}

/** A safe id from a name (or the host when the name is empty): lower case, letters, digits and dashes, at most 40 characters, never empty. */
export const slugFor = (name, host) => {
  const s = String(typeof name === 'string' && name.trim() !== '' ? name : (host || 'server')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return /^[a-z0-9]/.test(s) ? s : 'server'
}

/** The text of a response, with never more than `max` bytes of it read: `null` when the body is bigger (the reading is cancelled, the rest is never pulled).
 *  A server that answers 200 and then sends without end used to be read in full by `res.text()` (+2 GB of memory in 3 s, recette L3-25) before the size was
 *  looked at. The announced length is believed only to refuse early; the bytes are counted as they arrive. A response with no stream (a stand-in in a test)
 *  is read with `text()`, as before. */
const readBounded = async (res, max) => {
  const announced = Number(res.headers?.get?.('content-length'))
  const stream = res.body
  if (Number.isFinite(announced) && announced > max) { try { await stream?.cancel?.() } catch (e) { /* closing anyway */ } return null }
  if (stream === null || stream === undefined || typeof stream.getReader !== 'function') {
    const whole = await res.text()
    return whole.length > max ? null : whole
  }
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let read = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    read += value.byteLength
    if (read > max) { try { await reader.cancel() } catch (e) { /* closing anyway */ } return null }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

/** Never throws. `{ ok, steps: [{ id, ok, note? }], profile?, published?, host?, base?, error? }`.
 *  Errors: bad_address, insecure_address, unreachable, redirect, no_profile, incompatible (+ `dsh_min`).
 *  `timeoutMs` bounds the whole exchange, the body included: the timer runs until the document has been read (or refused), not only until the headers arrive. */
export const discover = async (address, { fetch: doFetch = globalThis.fetch, dshVersion = null, timeoutMs = 8000 } = {}) => {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  // Aborting at the end is a no-op for a body that was read in full, and it frees the connection of one that was not (a 404 or a redirect with a body nobody reads).
  try { return await discoverWithin(address, doFetch, dshVersion, ctl.signal) } finally { clearTimeout(timer); ctl.abort() }
}

const discoverWithin = async (address, doFetch, dshVersion, signal) => {
  const steps = []
  const parsed = parseAddress(address)
  if (parsed.ok !== true) return { ok: false, steps, error: parsed.error }
  let res = null
  try { res = await doFetch(parsed.base + WELL_KNOWN, { redirect: 'manual', signal, headers: { accept: 'application/json' } }) } catch (e) {
    steps.push({ id: 'reach', ok: false, note: 'unreachable' })
    return { ok: false, steps, error: 'unreachable' }
  }
  if (res.status >= 300 && res.status < 400) { steps.push({ id: 'reach', ok: false, note: 'redirect' }); return { ok: false, steps, error: 'redirect' } }
  steps.push({ id: 'reach', ok: true })
  if (res.status !== 200) { steps.push({ id: 'wellknown', ok: false, note: 'status_' + res.status }); return { ok: false, steps, error: 'no_profile' } }
  let doc = null
  try {
    const text = await readBounded(res, MAX_BYTES)
    if (text === null) throw new Error('too big')
    doc = JSON.parse(text)
  } catch (e) { steps.push({ id: 'wellknown', ok: false, note: 'unreadable' }); return { ok: false, steps, error: 'no_profile' } }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc) || typeof doc.api !== 'string') { steps.push({ id: 'wellknown', ok: false, note: 'no_api' }); return { ok: false, steps, error: 'no_profile' } }
  steps.push({ id: 'wellknown', ok: true })
  if (doc.schema !== 1) { steps.push({ id: 'compat', ok: false, note: 'schema_' + String(doc.schema) }); return { ok: false, steps, error: 'incompatible' } }
  if (typeof doc.dsh_min === 'string' && typeof dshVersion === 'string' && compareVersions(dshVersion, doc.dsh_min) < 0) {
    steps.push({ id: 'compat', ok: false, note: 'dsh_too_old' })
    return { ok: false, steps, error: 'incompatible', dsh_min: doc.dsh_min }
  }
  steps.push({ id: 'compat', ok: true, note: typeof doc.version === 'string' ? doc.version : undefined })
  const services = doc.services !== null && typeof doc.services === 'object' && !Array.isArray(doc.services) ? doc.services : {}
  const published = typeof doc.name === 'string' && doc.name.trim() !== '' ? doc.name.trim().slice(0, 60) : parsed.host
  const profile = { id: slugFor(doc.name, parsed.host), name: published, api: doc.api }
  if (typeof doc.web === 'string') profile.web = doc.web
  if (typeof doc.console === 'string') profile.console = doc.console
  // `llm` and `connections` are kept as published (a URL or false); the open half re-judges every address (a connections endpoint must be on the
  // same origin as `api`) and refuses the whole profile if one is wrong. Absent stays absent: « not offered » for connections, « same host » for llm.
  const wanted = {}
  if (services.llm === false || typeof services.llm === 'string') wanted.llm = services.llm
  if (services.connections === false || typeof services.connections === 'string') wanted.connections = services.connections
  if (Object.keys(wanted).length > 0) profile.services = wanted
  return { ok: true, steps, profile, published, host: parsed.host, base: parsed.base }
}
