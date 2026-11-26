// kybernos-websearch: the router. It runs a query through the person's engines, in their order, until one answers.
//
// DSH's web seam picks exactly one provider and fails when two are usable, so this plugin registers ONE provider and
// keeps the choice among engines here. What it adds over "pick one engine":
//   · a fallback chain: an engine that fails (a captcha, a refused key, a quota, a timeout) is skipped for a pause that
//     fits the cause, and the next one answers: a search only fails when every engine did;
//   · a per-engine spacing, because `web_search` fires its queries at once and the free HTML pages push back on that;
//   · a short answer cache, so the same question asked twice is not billed or throttled twice;
//   · the person's domain filter, applied to whatever engine answered.
//
// No network, no disk, no DSH here: `http`, `key`, `readSettings`, `now` and `sleep` are injected.
import { EngineError } from './engines.mjs'
import { parseDomainFilter, tidyResults } from './parse.mjs'

/** How long an engine is left alone after a failure, by cause. A refused key is not retried until the key changes. */
export const PAUSE_MS = {
  auth: 60 * 60_000,
  quota: 5 * 60_000,
  blocked: 10 * 60_000,
  server: 2 * 60_000,
  network: 60_000,
  timeout: 60_000,
  parse: 10 * 60_000,
  config: 5 * 60_000
}

const CACHE_MAX = 50

const abortError = () => Object.assign(new Error('web search aborted'), { name: 'WebError', code: 'WEB_ABORTED' })
const providerError = (message) => Object.assign(new Error(message), { name: 'WebError', code: 'WEB_PROVIDER_ERROR' })

const KIND_TEXT = {
  auth: 'its key was refused',
  quota: 'it is rate limited or out of quota',
  blocked: 'it asked for a challenge',
  server: 'it answered an error',
  network: 'it could not be reached',
  timeout: 'it did not answer in time',
  parse: 'its answer could not be read',
  config: 'it is not set up correctly',
  empty: 'it found nothing',
  paused: 'it is paused after a recent failure',
  missing: 'it needs a key or an address'
}

/**
 * @param {{
 *   engines: Array,
 *   readSettings: () => unknown,
 *   key: (ref: string) => Promise<string|null>,
 *   http: (url: string, init: object) => Promise<{ status: number, ok: boolean, text: string }>,
 *   now?: () => number,
 *   sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
 * }} deps
 */
export function createRouter (deps) {
  const now = deps.now || (() => Date.now())
  const sleep = deps.sleep || ((ms, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(abortError()) }, { once: true })
  }))
  const health = new Map()
  const lastStart = new Map()
  const gates = new Map()
  const cache = new Map()
  let last = null

  const record = (id) => {
    if (!health.has(id)) health.set(id, { openUntil: 0, kind: null, message: '', reason: null, at: 0, calls: 0, failures: 0, lastMs: null, lastCount: null, lastOkAt: 0 })
    return health.get(id)
  }
  const byId = new Map(deps.engines.map((e) => [e.id, e]))
  // `readSettings` returns a NORMALIZED document (host.mjs does it): this module knows engines, not the settings file.
  const settings = () => deps.readSettings()
  const hasAllKeys = async (engine) => {
    for (const r of engine.refs) {
      if (r.optional === true) continue
      let v = null
      try { v = await deps.key(r.ref) } catch (e) { v = null }
      if (typeof v !== 'string' || v === '') return false
    }
    return true
  }
  const optionsOf = (s) => ({ searxngUrl: s.searxngUrl, customUrl: s.customUrl, googleCx: s.googleCx, wikiLang: s.wikiLang })
  const hasAddress = (engine, s) => engine.field === undefined || engine.access === 'free' || (typeof s[engine.field] === 'string' && s[engine.field] !== '')
  const configuredFor = async (engine, s) => {
    if (engine.access === 'free') return true
    if (!hasAddress(engine, s)) return false
    return engine.access === 'url' ? true : hasAllKeys(engine)
  }

  const gate = async (engine, signal) => {
    const gap = engine.minIntervalMs || 0
    if (gap === 0) return
    const prev = gates.get(engine.id) || Promise.resolve()
    const mine = prev.then(async () => {
      const wait = (lastStart.get(engine.id) || 0) + gap - now()
      if (wait > 0) await sleep(wait, signal)
      lastStart.set(engine.id, now())
    })
    gates.set(engine.id, mine.catch(() => undefined))
    await mine
  }

  /** A word for what a failed connection ran into, from the cause Node attaches to « fetch failed »; null when it says nothing. The page
   *  turns the word into a sentence in the person's language (A3-26: « fetch failed » told nobody that nothing listens there). */
  const networkReason = (e) => {
    const c = e && e.cause !== undefined && e.cause !== null ? e.cause : e
    const code = String((c && c.cause && c.cause.code) || (c && c.code) || (e && e.code) || '')
    if (code === 'ECONNREFUSED') return 'refused'
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'notfound'
    if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'reset'
    if (/CERT|TLS|SSL|SELF_SIGNED/.test(code)) return 'tls'
    if (c !== null && c !== undefined && String(c.message) === 'bad port') return 'badport' // a port the fetch standard refuses (1, 25, 6000…)
    return null
  }

  const classify = (e, signal) => {
    if (signal !== undefined && signal.aborted === true) return { kind: 'aborted', message: 'aborted' }
    if (e instanceof EngineError) return e.kind === 'network' ? { kind: e.kind, message: e.message, reason: networkReason(e) } : { kind: e.kind, message: e.message }
    const name = e !== null && typeof e === 'object' ? String(e.name || '') : ''
    if (name === 'AbortError' || name === 'TimeoutError') return { kind: 'timeout', message: 'timed out' }
    return { kind: 'network', message: String((e && e.message) || e).slice(0, 160), reason: networkReason(e) }
  }

  const fail = (engine, kind, message, reason) => {
    const rec = record(engine.id)
    rec.calls += 1
    rec.failures += 1
    rec.kind = kind
    rec.message = String(message).slice(0, 200)
    rec.reason = reason || null
    rec.at = now()
    rec.openUntil = PAUSE_MS[kind] !== undefined ? now() + PAUSE_MS[kind] : 0
  }

  const succeed = (engine, ms, count) => {
    const rec = record(engine.id)
    rec.calls += 1
    rec.kind = null
    rec.message = ''
    rec.reason = null
    rec.openUntil = 0
    rec.lastMs = ms
    rec.lastCount = count
    rec.lastOkAt = now()
  }

  /** One engine, once: its raw answer, tidied. Throws what the engine threw. */
  const runOne = async (engine, query, count, s, signal) => {
    await gate(engine, signal)
    const t0 = now()
    const http = (url, init) => deps.http(url, { ...init, timeoutMs: s.timeoutS * 1000 })
    const raw = await engine.run({ query, count, signal, http, key: deps.key, opt: optionsOf(s) })
    return { items: tidyResults(raw, { filter: parseDomainFilter(s.domains), max: Math.max(count, 1) }), ms: now() - t0 }
  }

  return {
    /** A cheap, local answer to "can this provider be asked": at least one engine is switched on. */
    available () {
      try {
        const s = settings()
        return Object.values(s.enabled).some((v) => v === true)
      } catch (e) { return false }
    },

    /** Runs the chain. Resolves `{ sources, truncated, engine }`; throws a WebError-shaped Error when every engine failed. */
    async search ({ query, maxResults }, signal) {
      const q = String(query === undefined || query === null ? '' : query).trim()
      if (q === '') throw providerError('The web search query is empty.')
      if (signal !== undefined && signal.aborted === true) throw abortError()
      const s = settings()
      const count = Number.isInteger(maxResults) && maxResults > 0 ? Math.min(maxResults, 50) : 10
      const chain = s.order.filter((id) => s.enabled[id] === true && byId.has(id)).map((id) => byId.get(id))
      if (chain.length === 0) throw providerError('Every web search engine is switched off. Tell the person to switch one on in Settings > Web search.')

      const cacheKey = JSON.stringify([q.toLowerCase(), count, s.domains, chain.map((e) => e.id)])
      const ttl = s.cacheMinutes * 60_000
      if (ttl > 0) {
        const hit = cache.get(cacheKey)
        if (hit !== undefined && now() - hit.at < ttl) return { sources: hit.sources.slice(), truncated: false, engine: hit.engine, cached: true }
      }

      const trace = []
      for (const engine of chain) {
        if (signal !== undefined && signal.aborted === true) throw abortError()
        if (!(await configuredFor(engine, s))) { trace.push({ id: engine.id, result: 'missing' }); continue }
        const rec = record(engine.id)
        if (rec.openUntil > now()) { trace.push({ id: engine.id, result: 'paused', kind: rec.kind, until: rec.openUntil }); continue }
        try {
          const { items, ms } = await runOne(engine, q, count, s, signal)
          if (items.length === 0) {
            const r = record(engine.id)
            r.calls += 1
            r.lastMs = ms
            r.lastCount = 0
            trace.push({ id: engine.id, result: 'empty' })
            continue
          }
          succeed(engine, ms, items.length)
          trace.push({ id: engine.id, result: 'ok', ms, count: items.length })
          last = { at: now(), engine: engine.id, ms, count: items.length, trace }
          if (ttl > 0) {
            if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
            cache.set(cacheKey, { at: now(), sources: items, engine: engine.id })
          }
          return { sources: items, truncated: false, engine: engine.id }
        } catch (e) {
          const { kind, message, reason } = classify(e, signal)
          if (kind === 'aborted') throw abortError()
          fail(engine, kind, message, reason)
          trace.push({ id: engine.id, result: kind, message })
        }
      }
      last = { at: now(), engine: null, ms: null, count: 0, trace }
      throw providerError(explain(trace))
    },

    /** Asks ONE engine, whatever its switch and pause say: what the page's "Test" button shows. Never throws. */
    async probe (id, query, signal) {
      const engine = byId.get(id)
      if (engine === undefined) return { ok: false, kind: 'config', message: 'unknown engine' }
      const s = settings()
      if (!(await configuredFor(engine, s))) return { ok: false, kind: 'missing', message: KIND_TEXT.missing }
      try {
        const { items, ms } = await runOne(engine, String(query || 'open source search engine'), 5, s, signal)
        if (items.length === 0) return { ok: false, kind: 'empty', message: KIND_TEXT.empty, ms }
        succeed(engine, ms, items.length)
        return { ok: true, ms, count: items.length, sample: items.slice(0, 3).map((r) => ({ title: r.title || '', url: r.url })) }
      } catch (e) {
        const { kind, message, reason } = classify(e, signal)
        if (kind !== 'aborted') fail(engine, kind, message, reason)
        return reason === undefined || reason === null ? { ok: false, kind, message } : { ok: false, kind, message, reason }
      }
    },

    /** What the page draws for one engine. */
    health (id) {
      const rec = record(id)
      return {
        calls: rec.calls,
        failures: rec.failures,
        lastMs: rec.lastMs,
        lastCount: rec.lastCount,
        lastOkAt: rec.lastOkAt || null,
        pausedUntil: rec.openUntil > now() ? rec.openUntil : null,
        kind: rec.kind,
        message: rec.message,
        reason: rec.reason || null
      }
    },

    last: () => last,

    /** A key or an address changed: whatever pause was set on this engine said something that is no longer true. */
    forget (id) {
      const rec = health.get(id)
      if (rec !== undefined) { rec.openUntil = 0; rec.kind = null; rec.message = ''; rec.reason = null }
      cache.clear()
    },

    clearCache: () => cache.clear()
  }
}

/** The error text the model reads when nothing answered: facts about OUR engines only, never remote content. */
export const explain = (trace) => {
  const lines = trace.map((t) => {
    const why = KIND_TEXT[t.result] || t.result
    return '- ' + t.id + ': ' + why
  })
  const recoverable = trace.length > 0 && trace.every((t) => t.result === 'blocked' || t.result === 'paused' || t.result === 'quota' || t.result === 'missing' || t.result === 'server' || t.result === 'network' || t.result === 'timeout')
  return 'No web search engine answered.\n' + lines.join('\n') +
    '\nThe search could not be done: do not guess the answer as if it had been looked up. ' +
    (recoverable ? 'Tell the person they can add an API key or a SearXNG address in Settings > Web search, or try again in a few minutes.' : 'Tell the person to check Settings > Web search.')
}
