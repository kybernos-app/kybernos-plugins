// kybernos-websearch: the one place that touches the network. `fetch` is injected so everything else can be played offline.
import { EngineError } from './engines.mjs'

/** Reads a body up to `max` bytes, then stops (a search page is a few hundred KB; anything much larger is not one). */
export const readCapped = async (res, max) => {
  if (res.body !== null && res.body !== undefined && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader()
    const chunks = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      chunks.push(value)
      if (size > max) { try { await reader.cancel() } catch (e) { /* closed */ } break }
    }
    return new TextDecoder('utf-8').decode(Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, max))
  }
  return String(await res.text()).slice(0, max)
}

/** `http(url, { method, headers, body, signal, timeoutMs })` → `{ status, ok, text }`. Throws EngineError('timeout' | 'network'). */
export const makeHttp = ({ fetchImpl = globalThis.fetch, maxBytes = 2_000_000 } = {}) => async (url, init = {}) => {
  const { timeoutMs = 12_000, signal, ...rest } = init
  const timeout = AbortSignal.timeout(timeoutMs)
  const both = signal !== undefined && signal !== null ? AbortSignal.any([signal, timeout]) : timeout
  const wrap = (e) => {
    if (signal !== undefined && signal !== null && signal.aborted === true) return Object.assign(new Error('aborted'), { name: 'AbortError' })
    if (timeout.aborted === true) return new EngineError('timeout', 'no answer within ' + Math.round(timeoutMs / 1000) + ' s')
    // The cause Node attaches to « fetch failed » (a refused connection, an unknown host…) rides along: the router words it (A3-26).
    return Object.assign(new EngineError('network', String((e && e.message) || e).slice(0, 160)), { cause: e !== null && typeof e === 'object' && e.cause !== undefined ? e.cause : e })
  }
  let res
  try { res = await fetchImpl(url, { ...rest, signal: both, redirect: 'follow' }) } catch (e) { throw wrap(e) }
  let text
  try { text = await readCapped(res, maxBytes) } catch (e) { throw wrap(e) }
  return { status: res.status, ok: res.status >= 200 && res.status < 300, text }
}
