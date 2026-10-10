// Is this API key accepted by its provider? One read-only request to the provider's own model list.
//
// Used by the first-run wizard before it saves a pasted key. Rules, all of them tested:
//  - the address is chosen HERE from a fixed table, never taken from the caller: the key can only ever go to the
//    provider it belongs to, so this cannot be turned into a way to send a key (or a request) elsewhere;
//  - a redirect is refused: a provider that answers with one does not get the key forwarded;
//  - nothing of the answer is kept: only a word comes back, never the body, never the key;
//  - global fetch, bounded by a timeout. A background request of ours must never go through the engine's web.fetch
//    (see test-no-engine-fetch.mjs).

const bearer = (key) => ({ authorization: 'Bearer ' + key })

/** The providers the wizard offers. `url` answers 200 to a valid key without spending anything. */
const PROVIDERS = {
  anthropic: { url: 'https://api.anthropic.com/v1/models', headers: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }), invalid: [401] },
  openai: { url: 'https://api.openai.com/v1/models', headers: bearer, invalid: [401] },
  deepseek: { url: 'https://api.deepseek.com/models', headers: bearer, invalid: [401] },
  // Google's OpenAI-compatible endpoint answers 400 « API key not valid » rather than 401.
  google: { url: 'https://generativelanguage.googleapis.com/v1beta/openai/models', headers: bearer, invalid: [400, 401] },
}

export const KEY_PROVIDERS = Object.keys(PROVIDERS)

// Printable ASCII, no space: what every provider's keys are made of, and nothing that could split a header.
const KEY_RE = /^[\x21-\x7e]{8,400}$/

const classify = (spec, status) => {
  if (status >= 200 && status < 300) return 'ok'
  if (spec.invalid.indexOf(status) >= 0) return 'invalid'
  if (status === 403) return 'denied'
  if (status === 429) return 'rate_limited'
  return 'unexpected'
}

/**
 * @returns {Promise<{ok:true,result:'ok'|'invalid'|'denied'|'rate_limited'|'unreachable'|'unexpected',http?:number}
 *                   |{ok:false,error:'unknown-provider'|'bad-key'}>}
 */
export const checkKey = async (provider, key, options = {}) => {
  if (typeof provider !== 'string' || !Object.prototype.hasOwnProperty.call(PROVIDERS, provider)) return { ok: false, error: 'unknown-provider' }
  const clean = typeof key === 'string' ? key.trim() : ''
  if (!KEY_RE.test(clean)) return { ok: false, error: 'bad-key' }
  const spec = PROVIDERS[provider]
  const doFetch = typeof options.fetch === 'function' ? options.fetch : globalThis.fetch
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 8000
  try {
    const res = await doFetch(spec.url, {
      method: 'GET',
      headers: { ...spec.headers(clean), accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const http = res.status
    // The body is never read: free the connection and keep nothing.
    try { if (res.body !== null && res.body !== undefined && typeof res.body.cancel === 'function') await res.body.cancel() } catch (e) { /* already closed */ }
    return { ok: true, result: classify(spec, http), http }
  } catch (e) {
    return { ok: true, result: 'unreachable' }
  }
}
