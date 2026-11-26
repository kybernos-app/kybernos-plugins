// ── The name on the door: a Kybernos User-Agent on every outbound call, no engine patch ──
//
// Measured 2026-10-28: every provider request leaves with the engine's own attribution,
// `deepseek-harness/<version> (+https://github.com/deepseek-ai/deepseek-harness)`, and that string
// shows up in the providers' request logs — the brand of the engine, not of the product the
// person runs. The engine builds it in `@deepseek-ai/dsh-llm` (`attributionHeaders()` reads a
// hard-coded APP_IDENTITY) and exports nothing that changes it; the pi-ai profile `headers` cannot
// win either, because the adapter filters attribution collisions out before merging
// (`requestHeaders()` in `@deepseek-ai/dsh-llm-pi-ai`). So the only zero-patch seam (AGENTS.md
// rule 1) is the transport itself:
//
//   · the adapters hand `fetch` the same `user-agent` header on the wire;
//   · the provider SDKs (`openai`, `@anthropic-ai/sdk` — read in the engine's node_modules) resolve
//     `globalThis.fetch` when a client is built, and pi-ai builds its clients PER REQUEST, so a
//     wrapper installed at boot is the one that runs;
//   · `deepseek`'s own adapter would capture `globalThis.fetch` in its constructor, so it too gets
//     the wrapper whenever it is built after this bundle mounts (it is not used by the Kybernos
//     profile, which routes everything through pi-ai).
//
// Narrow on purpose: only a `deepseek-harness/…` value is rewritten. The SDK's own `pi-ai/…`, an
// upstream contract's `opencode/<version>` (the free-model gate of kybernos-free-llms) or an OAuth
// `claude-cli/…` pass through untouched, so a provider that keys on its own product token keeps
// working. A failure inside the wrapper never changes the call: the request goes out exactly as it
// would have (a bundle must never break DSH — AGENTS.md rule 2).
//
// Proof after a restart: `~/.dsh/logs/app-identity.log` carries one line per provider host
// (`<iso>  <host>  user-agent: kybernos/x.y.z (+https://kybernos.app)`), which is the value the
// provider's own log shows. `KYBERNOS_UA_LOG=off` silences it, `KYBERNOS_UA_LOG=<path>` moves it,
// `KYBERNOS_USER_AGENT=<full ua>` overrides the value, `KYBERNOS_APP_IDENTITY=off` does not wrap at
// all. Env is read at boot only, so all of this is reversible without touching a file of the engine.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshHomeSync } from './dsh-home.mjs'

/** The product identity every outbound provider call carries once installed. */
export const APP_IDENTITY = { product: 'kybernos', url: 'https://kybernos.app' }

/** The attribution the engine sends before we install (`@deepseek-ai/dsh-llm` APP_IDENTITY). */
const ENGINE_ATTRIBUTION = /^deepseek-harness\//i
/** A version we are willing to advertise; anything else falls back to the next source. */
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/
/** Marks a wrapper this module built, so a second install reuses it instead of stacking. */
const WRAPPED = Symbol.for('kybernos.app-identity.wrapper')
/** Values of KYBERNOS_APP_IDENTITY that mean "leave the engine's attribution alone". */
const OFF = new Set(['off', 'none', '0', 'false', 'no', 'native'])
/** (host + value) already written to the proof log by this process. */
const written = new Set()

/**
 * One User-Agent value, `product/version (+url)` (RFC 9110 §10.1.5 product + comment).
 * @param {{product: string, url: string}} identity
 * @param {string} version
 * @returns {string}
 */
export function userAgentOf (identity, version) {
  return identity.product + '/' + version + ' (+' + identity.url + ')'
}

/**
 * The Kybernos version to advertise: `KYBERNOS_VERSION`, else the pack's `VERSION` file, else the
 * bundle's `package.json`, else `0.0.0`. Read once at boot.
 * @param {string} [dir] the bundle folder (the default resolves to this module's own).
 * @param {Record<string, unknown>} [env]
 * @returns {string}
 */
export function versionOf (dir = dirname(fileURLToPath(import.meta.url)), env = process.env) {
  const declared = String(env?.KYBERNOS_VERSION ?? '').trim()
  if (SEMVER.test(declared)) return declared
  for (const file of [join(dir, '..', '..', 'VERSION'), join(dir, 'package.json')]) {
    try {
      const text = readFileSync(file, 'utf8')
      const value = file.endsWith('.json') ? JSON.parse(text)?.version : text.trim()
      if (SEMVER.test(String(value).trim())) return String(value).trim()
    } catch (e) { /* next source: a missing or unreadable file is not a failure */ }
  }
  return '0.0.0'
}

/**
 * The value to send instead of the engine's attribution: `KYBERNOS_USER_AGENT` when set (a full
 * header value, for support), else the Kybernos identity and version.
 * @param {Record<string, unknown>} [env]
 * @param {string} [dir]
 * @returns {string}
 */
export function desiredUserAgent (env = process.env, dir) {
  const forced = String(env?.KYBERNOS_USER_AGENT ?? '').trim()
  if (forced !== '') return forced
  return userAgentOf(APP_IDENTITY, versionOf(dir, env))
}

/**
 * Whether a header value is the engine's own attribution (the only thing this module rewrites).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isEngineAttribution (value) {
  return typeof value === 'string' && ENGINE_ATTRIBUTION.test(value.trim())
}

/**
 * The same headers with the engine's attribution replaced, or `null` when there is nothing to
 * replace (so the caller can leave the original request untouched).
 * @param {Headers|Record<string, string>|Array<[string, string]>} headers
 * @param {string} ua
 * @returns {Headers|null}
 */
export function withAppIdentity (headers, ua) {
  const out = new Headers(headers)
  if (isEngineAttribution(out.get('user-agent')) === false) return null
  out.set('user-agent', ua)
  return out
}

/** The host of a fetch target, for the proof log; never throws. */
function hostOf (target) {
  try {
    const url = typeof target === 'string' ? target : (typeof URL !== 'undefined' && target instanceof URL ? target.href : target?.url)
    return new URL(String(url)).host || 'unknown-host'
  } catch (e) { return 'unknown-host' }
}

/**
 * Write the value that really went out, once per (host, value) for this process, so the proof is
 * one line per provider instead of one per request. Never throws (a full disk must not fail a call).
 * @param {string} host
 * @param {string} ua
 * @param {{env?: Record<string, unknown>, now?: Date}} [opts]
 * @returns {string|null} the file written, or null when logging is off or the write failed.
 */
export function logOutboundIdentity (host, ua, opts = {}) {
  const env = opts.env ?? process.env
  const declared = String(env?.KYBERNOS_UA_LOG ?? '').trim()
  if (OFF.has(declared.toLowerCase())) return null
  const file = declared === '' ? join(dshHomeSync(env), 'logs', 'app-identity.log') : declared
  const key = host + ' ' + ua
  if (written.has(key)) return file
  // Recorded BEFORE the write: a writable-disk failure must not retry on every request of a session.
  written.add(key)
  try {
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, (opts.now instanceof Date ? opts.now : new Date()).toISOString() + '  ' + host + '  user-agent: ' + ua + '\n')
    return file
  } catch (e) { return null }
}

/** Forget what the proof log already wrote (tests only: a process writes each host once). */
export function resetOutboundLog () {
  written.clear()
}

/**
 * The `fetch(input, init)` arguments with the outbound identity applied. Pure: it builds the new
 * arguments and reports the host; it never calls the network and never mutates its inputs.
 * @param {RequestInfo|URL|string} input
 * @param {RequestInit|undefined} init
 * @param {string} ua
 * @param {(host: string, ua: string) => void} [note]
 * @returns {[unknown, RequestInit|undefined]}
 */
export function rewriteArgs (input, init, ua, note) {
  const supplied = init !== undefined && init !== null ? init.headers : undefined
  if (supplied !== undefined && supplied !== null) {
    const headers = withAppIdentity(supplied, ua)
    if (headers === null) return [input, init]
    if (typeof note === 'function') note(hostOf(input), ua)
    return [input, { ...init, headers }]
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    const headers = withAppIdentity(input.headers, ua)
    if (headers === null) return [input, init]
    if (typeof note === 'function') note(hostOf(input.url), ua)
    const merged = init === undefined || init === null ? { headers } : { ...init, headers }
    return [new Request(input, merged), undefined]
  }
  return [input, init]
}

/**
 * Install the outbound identity once. Idempotent, and a no-op when there is no fetch to wrap.
 * @param {{
 *   env?: Record<string, unknown>,
 *   holder?: {fetch?: Function},
 *   fetchImpl?: Function,
 *   userAgent?: string,
 *   dir?: string,
 *   log?: (host: string, ua: string) => void,
 * }} [options]
 * @returns {{installed: boolean, ua: string|null, reused?: boolean, previous?: string|null, reason: string|null, restore: () => void}}
 */
export function installAppIdentity (options = {}) {
  const env = options.env ?? process.env
  const holder = options.holder ?? globalThis
  const base = options.fetchImpl ?? holder?.fetch
  const noop = { installed: false, ua: null, reason: null, restore: () => {} }
  const mode = String(env?.KYBERNOS_APP_IDENTITY ?? '').trim().toLowerCase()
  if (OFF.has(mode)) return { ...noop, reason: 'switched off by KYBERNOS_APP_IDENTITY' }
  if (typeof base !== 'function') return { ...noop, reason: 'no fetch to wrap' }
  const previous = typeof base[WRAPPED] === 'string' ? base[WRAPPED] : null
  const ua = options.userAgent ?? desiredUserAgent(env, options.dir)
  // Already ours (a second install, a reloaded bundle): reuse it rather than nesting wrappers.
  if (previous !== null) return { installed: true, reused: true, previous, ua: previous, reason: null, restore: () => {} }
  const note = options.log ?? ((host, value) => { logOutboundIdentity(host, value, { env }) })
  const wrapper = function (input, init) {
    let args = [input, init]
    try { args = rewriteArgs(input, init, ua, note) } catch (e) { args = [input, init] }
    return Reflect.apply(base, this, args)
  }
  wrapper[WRAPPED] = ua
  try {
    holder.fetch = wrapper
  } catch (e) {
    return { ...noop, reason: 'fetch is read-only here: ' + (e && e.message ? e.message : String(e)) }
  }
  return {
    installed: true,
    reused: false,
    previous: null,
    ua,
    reason: null,
    restore: () => { try { if (holder.fetch === wrapper) holder.fetch = base } catch (e) { /* frozen holder: nothing to restore */ } },
  }
}
