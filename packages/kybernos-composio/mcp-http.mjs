// MCP over HTTP: the few helpers both the Composio calls (index.js) and the connector test
// (mcp-probe.mjs) need. Nothing here knows about Composio, a key or a file.

export function mcpFailure(code) { const e = new Error(code); e.mcpCode = code; return e }

/**
 * Why a call failed, as a short code the page can show: 401 (key rejected), 429 (rate limited),
 * another HTTP status, timeout, offline, bad-response (not a JSON-RPC answer: a captive
 * portal, an HTML page), rpc-error (a JSON-RPC error object) or tool-error (the tool said it failed).
 */
export function failureCode(e) { return e !== null && e !== undefined && typeof e.mcpCode === 'string' ? e.mcpCode : 'offline' }

/**
 * Decodes a JSON-RPC body: bare JSON or text/event-stream (`data: {...}`). Both forms are
 * served by connect.composio.dev depending on the negotiated accept, so SSE is tried first,
 * then raw JSON, exactly like the client.
 */
export function decodeRpc(raw) {
  let payload = null
  for (const line of String(raw).split('\n')) {
    if (line.indexOf('data:') !== 0) continue
    try { payload = JSON.parse(line.slice(5).trim()) } catch (e) { /* partial SSE block */ }
  }
  if (payload === null) { try { payload = JSON.parse(String(raw)) } catch (e) { payload = null } }
  return payload
}

/**
 * One HTTP exchange under ONE deadline: the status, the headers AND the body must all arrive
 * within `ms`. The timer used to be cleared as soon as the headers came, so a server that
 * stalled the body hung the request, and every later one behind it (coalescing shares one
 * promise). The body is only read when the status is ok. Returns { res, raw }; throws an
 * mcpFailure ('timeout' or 'offline').
 */
export async function exchange(url, init, ms) {
  const controller = new AbortController()
  const deadline = new Promise((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(mcpFailure('timeout')), { once: true })
  })
  deadline.catch(() => { /* nothing races it any more */ })
  const timer = setTimeout(() => controller.abort(), ms)
  const failed = (e) => (e !== null && e !== undefined && typeof e.mcpCode === 'string' ? e
    : mcpFailure(controller.signal.aborted === true || (e !== null && e !== undefined && e.name === 'AbortError') ? 'timeout' : 'offline'))
  try {
    let res = null
    try { res = await Promise.race([fetch(url, Object.assign({}, init, { signal: controller.signal })), deadline]) } catch (e) { throw failed(e) }
    if (res === null || res === undefined) throw mcpFailure('offline')
    let raw = ''
    if (res.ok === true) {
      try { raw = await Promise.race([res.text(), deadline]) } catch (e) { throw failed(e) }
    }
    return { res: res, raw: String(raw) }
  } finally { clearTimeout(timer) }
}
