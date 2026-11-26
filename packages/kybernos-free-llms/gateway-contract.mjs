// Pure request-contract rules for the OpenCode Zen free tier (no account, no key).
//
// No I/O and no crypto dependency here: index.js does the network and hands raw
// bodies to these functions, so the free-tier gate rules are tested without a host.
//
// Measured against the live endpoint (2026-10-12) by bisecting each barrier: the
// free tier answers 403 `FreeTierError` unless a chat request carries all four of
//
//   1. `User-Agent` carrying `opencode/<version>` with version >= 1.17,
//   2. an `x-opencode-session` shaped `ses_` + 12 hex + 14 base62 (shape checked,
//      value not),
//   3. `stream: true` in the body,
//   4. a non-empty `tools` array whose names the upstream recognises — the real
//      quartet `{bash, glob, grep, read}`. Fake names are refused; extras are fine.
//
// Removing any one turns a 200 into a 403. A model whose wire protocol the
// upstream does not serve answers `ModelProtocolUnsupported` (a 400) regardless —
// that is a model property, not a gate we can pass.

/** User-Agent the upstream accepts. `opencode-cli/…` is refused (no parsable version). */
export const OPENCODE_USER_AGENT = 'opencode/1.18.31'

/** Canonical id shape the upstream validates: `<prefix>` + 12 hex + 14 base62. */
export const SESSION_PATTERN = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/
export const REQUEST_PATTERN = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const MIN_VERSION_MINOR = 17

/**
 * Whether a User-Agent already satisfies the upstream contract (so it is kept).
 * The upstream only parses `opencode/<major>.<minor>`; below 1.17 it answers 426.
 */
export const userAgentOk = (ua) => {
  const match = /opencode\/(?:[a-z]+\/)?v?(\d+)\.(\d+)/i.exec(String(ua || ''))
  if (match === null) return false
  const major = Number.parseInt(match[1], 10)
  const minor = Number.parseInt(match[2], 10)
  return Number.isFinite(major) && Number.isFinite(minor) && (major > 1 || (major === 1 && minor >= MIN_VERSION_MINOR))
}

/**
 * Render an id in the canonical shape. `bytes` is a Buffer-like of at least 20
 * bytes; the value is not checked upstream, so no timestamp algorithm is needed.
 */
export const canonicalId = (prefix, bytes) => {
  const hex = bytes.subarray(0, 6).toString('hex')
  const tail = Array.from(bytes.subarray(6, 20), (b) => BASE62[b % 62]).join('')
  return prefix + hex + tail
}

/** The placeholder tool quartet the free tier requires. Descriptions are ours. */
export const REQUIRED_TOOLS = [
  { name: 'bash', description: 'Run a bash command.' },
  { name: 'glob', description: 'Find files by glob pattern.' },
  { name: 'grep', description: 'Search file contents.' },
  { name: 'read', description: 'Read a file.' },
]

const asTool = (t) => ({
  type: 'function',
  function: {
    name: t.name,
    description: t.description,
    parameters: { type: 'object', properties: {} },
  },
})

/**
 * Rewrite one request body up to the free-tier contract. Idempotent and
 * non-destructive: a caller's own `tools` are kept verbatim (they already carry
 * real names), and the placeholder quartet is added only when there are none.
 *
 * @param {object} body  parsed request body
 * @returns {{body: object, addedTools: boolean}}
 */
export const applyContract = (body) => {
  const out = body !== null && typeof body === 'object' && !Array.isArray(body) ? { ...body } : {}
  out.stream = true
  const hasTools = Array.isArray(out.tools) && out.tools.length > 0
  if (hasTools) return { body: out, addedTools: false }
  out.tools = REQUIRED_TOOLS.map(asTool)
  if (out.tool_choice === undefined) out.tool_choice = 'none'
  return { body: out, addedTools: true }
}

/**
 * Build the headers that satisfy the two header gates. A caller's User-Agent is
 * kept only when it already passes; session and request ids are always minted
 * (the upstream checks their shape, not their value).
 *
 * @param {object} opts
 * @param {(n:number)=>Buffer} opts.randomBytes  injected for deterministic tests
 * @param {string} [opts.userAgent]
 * @returns {Record<string,string>}
 */
export const contractHeaders = ({ randomBytes, userAgent }) => {
  const ua = userAgentOk(userAgent) ? userAgent : OPENCODE_USER_AGENT
  return {
    'User-Agent': ua,
    'x-opencode-client': 'cli',
    'x-opencode-project': 'default',
    'x-opencode-session': canonicalId('ses_', randomBytes(20)),
    'x-opencode-request': canonicalId('msg_', randomBytes(20)),
    Accept: 'text/event-stream',
  }
}

/**
 * Classify an upstream error body into a stable code, so the health probe and the
 * gateway can report the same words. `null` when the body carries no error.
 */
export const classifyError = (parsed) => {
  if (parsed === null || typeof parsed !== 'object') return null
  const err = parsed.error !== undefined ? parsed.error : parsed
  const type = err !== null && typeof err === 'object' && typeof err.type === 'string' ? err.type : null
  const message = err !== null && typeof err === 'object' && typeof err.message === 'string' ? err.message : ''
  if (type === 'FreeTierError' || /free tier/i.test(message)) return 'free_tier_locked'
  if (type === 'ModelProtocolUnsupported' || /does not support this protocol/i.test(message)) return 'model_protocol_unsupported'
  if (type === 'ModelNotFound' || /not supported|unknown model/i.test(message)) return 'model_unknown'
  if (/rate limit|429/i.test(message)) return 'rate_limited'
  return 'upstream_error'
}
