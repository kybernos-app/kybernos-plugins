// Reads a connector block of cordis.patch.yml back into what the connector form edits.
//
// The form writes the blocks itself (index.js renderBlock), so it knows their shape. A block written
// by something else (the connecteur-personnalise skill, a person) used to be listed read only, with
// the transport and the address and nothing else: it could not be edited. This reads the whole of it,
// and is strict about what it does NOT understand: a block that holds anything the form could not
// write back exactly (a computed value, an option it does not know) is reported read only, with the
// reason, instead of being rewritten without that part.
//
// Pure: the YAML parser is passed in (index.js finds the one that ships with DSH).

const KNOWN_CONFIG = new Set(['serverName', 'transport', 'command', 'args', 'cwd', 'env', 'url', 'headers', 'toolCallTimeoutMs', 'failOnStartupError', 'reconnect'])
const KNOWN_ENTRY = new Set(['id', 'name', 'config', 'disabled'])
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The text a `!!js` expression stands for, as the form writes values: `$NAME` for a reference to
 * a secret, the rest literally. Understands the shapes in use: what renderValue writes
 * (`"lit" + (process.env.NAME || '') + "lit"`), a bare `process.env.NAME`, and a template literal
 * (`Bearer ${process.env.NAME}`). Returns { value } or { complex: true } for anything else.
 */
export function valueOfJs(expr) {
  const s = String(expr)
  const parts = []
  let i = 0
  const skip = () => { while (i < s.length && /\s/.test(s[i])) i += 1 }
  const env = (from) => {
    const m = /^\(?\s*process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*(?:'([A-Za-z_][A-Za-z0-9_]*)'|"([A-Za-z_][A-Za-z0-9_]*)")\s*\])\s*(?:\|\|\s*(?:''|""))?\s*\)?/.exec(s.slice(from))
    if (m === null) return null
    const name = m[1] || m[2] || m[3]
    // Parentheses must balance: `(process.env.X || '')` yes, `(process.env.X` no.
    if ((m[0].startsWith('(') === true) !== (m[0].endsWith(')') === true)) return null
    return { name: name, end: from + m[0].length }
  }
  const literalOk = (text) => /\$[A-Z_]/.test(text) === false // a "$NAME" inside a literal could not be told from a reference
  for (;;) {
    skip()
    if (i >= s.length) return { complex: true }
    const ch = s[i]
    if (ch === '"' || ch === "'") {
      let j = i + 1
      let raw = ''
      for (; j < s.length && s[j] !== ch; j += 1) { if (s[j] === '\\') { raw += s[j] + (s[j + 1] === undefined ? '' : s[j + 1]); j += 1 } else raw += s[j] }
      if (j >= s.length) return { complex: true }
      let text = null
      try { text = ch === '"' ? JSON.parse('"' + raw + '"') : raw.replace(/\\'/g, "'").replace(/\\\\/g, '\\') } catch (e) { return { complex: true } }
      if (literalOk(text) !== true) return { complex: true }
      parts.push(text)
      i = j + 1
    } else if (ch === '`') {
      let j = i + 1
      let acc = ''
      for (; j < s.length && s[j] !== '`'; j += 1) {
        if (s[j] === '\\') return { complex: true }
        if (s[j] === '$' && s[j + 1] === '{') {
          const close = s.indexOf('}', j)
          if (close < 0) return { complex: true }
          const m = /^\s*process\.env\.([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(s.slice(j + 2, close))
          if (m === null) return { complex: true }
          if (acc.length > 0) { if (literalOk(acc) !== true) return { complex: true }; parts.push(acc); acc = '' }
          parts.push('$' + m[1])
          j = close
        } else acc += s[j]
      }
      if (j >= s.length) return { complex: true }
      if (acc.length > 0) { if (literalOk(acc) !== true) return { complex: true }; parts.push(acc) }
      i = j + 1
    } else {
      const e = env(i)
      if (e === null) return { complex: true }
      parts.push('$' + e.name)
      i = e.end
    }
    skip()
    if (i >= s.length) break
    if (s[i] !== '+') return { complex: true }
    i += 1
  }
  return { value: parts.join('') }
}

/** { name, value } rows from a YAML mapping of name -> text or !!js expression; or { reason }. */
function rowsOf(map, what) {
  const rows = []
  if (map === undefined || map === null) return { rows: rows }
  if (typeof map !== 'object' || Array.isArray(map)) return { reason: what + ' is not a list of name: value' }
  for (const k of Object.keys(map)) {
    const v = map[k]
    if (v !== null && typeof v === 'object' && typeof v.__jsExpr === 'string') {
      const r = valueOfJs(v.__jsExpr)
      if (r.complex === true) return { reason: what + ' ' + k + ' is a computed value' }
      rows.push({ name: k, value: r.value })
    } else if (typeof v === 'string') rows.push({ name: k, value: v })
    else if (typeof v === 'number' || typeof v === 'boolean') rows.push({ name: k, value: String(v) })
    else return { reason: what + ' ' + k + ' is not a text' }
  }
  return { rows: rows }
}

/**
 * Reads the block of connector `nom` (`lines`: its text, from the `# connecteur:` marker on).
 * `loadYaml(text)` parses like DSH does (`!!js` as { __jsExpr }) and throws on bad YAML, or is null
 * when no parser is reachable. Returns { connecteur } (the form's shape, plus `disabled`), or
 * { readOnly: '<reason>' } when the block cannot be written back without losing something.
 */
export function readConnector(nom, lines, loadYaml) {
  if (typeof loadYaml !== 'function') return { readOnly: 'no YAML parser is reachable' }
  let doc = null
  try { doc = loadYaml(lines.join('\n')) } catch (e) { return { readOnly: 'the block does not parse' } }
  if (Array.isArray(doc) === false || doc.length !== 1 || doc[0] === null || typeof doc[0] !== 'object' || Array.isArray(doc[0].insert) === false) return { readOnly: 'the block is not a single insert' }
  const inserts = doc[0].insert
  if (inserts.length !== 1 || inserts[0] === null || typeof inserts[0] !== 'object') return { readOnly: 'the block does not hold exactly one entry' }
  const entry = inserts[0]
  for (const k of Object.keys(entry)) if (KNOWN_ENTRY.has(k) === false) return { readOnly: 'the entry has an option the form does not know (' + k + ')' }
  if (entry.name !== '@deepseek-ai/dsh-mcp-client') return { readOnly: 'it is not an MCP client entry' }
  if (entry.id !== 'mcp-client-' + nom) return { readOnly: 'its id is not mcp-client-' + nom }
  if (entry.disabled !== undefined && typeof entry.disabled !== 'boolean') return { readOnly: 'disabled is not true or false' }
  const c = entry.config
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return { readOnly: 'the entry has no config' }
  for (const k of Object.keys(c)) if (KNOWN_CONFIG.has(k) === false) return { readOnly: 'the config has an option the form does not know (' + k + ')' }
  if (c.serverName !== nom) return { readOnly: 'its serverName is not ' + nom + ', and the tools\' names depend on it' }
  if (c.transport !== 'stdio' && c.transport !== 'streamable-http') return { readOnly: 'transport is neither stdio nor streamable-http' }
  if (c.failOnStartupError !== undefined && c.failOnStartupError !== false) return { readOnly: 'failOnStartupError is not false' }
  if (c.reconnect !== undefined) {
    const r = c.reconnect
    if (r === null || typeof r !== 'object' || r.enabled !== true || r.maxAttempts !== 10 || Object.keys(r).length !== 2) return { readOnly: 'reconnect is not the standard one' }
  }
  const out = { nom: nom, transport: c.transport, disabled: entry.disabled === true }
  if (c.toolCallTimeoutMs !== undefined) {
    if (Number.isInteger(c.toolCallTimeoutMs) === false || c.toolCallTimeoutMs < 1000 || c.toolCallTimeoutMs > 3600000) return { readOnly: 'toolCallTimeoutMs is out of range' }
    out.toolCallTimeoutMs = c.toolCallTimeoutMs
  }
  if (c.transport === 'stdio') {
    if (typeof c.command !== 'string' || c.command.length === 0) return { readOnly: 'command is not a text' }
    out.command = c.command
    if (c.args !== undefined && Array.isArray(c.args) === false) return { readOnly: 'args is not a list' }
    const args = []
    for (const a of (c.args || [])) {
      if (a !== null && typeof a === 'object' && typeof a.__jsExpr === 'string') return { readOnly: 'an argument is a computed value' }
      if (typeof a !== 'string') return { readOnly: 'an argument is not a text' }
      args.push(a)
    }
    out.args = args
    if (c.cwd !== undefined) { if (typeof c.cwd !== 'string') return { readOnly: 'cwd is not a text' }; out.cwd = c.cwd }
    const env = rowsOf(c.env, 'env')
    if (env.reason !== undefined) return { readOnly: env.reason }
    for (const r of env.rows) if (NAME_RE.test(r.name) === false) return { readOnly: 'env name ' + r.name + ' is not a plain name' }
    out.env = env.rows
    if (c.url !== undefined || c.headers !== undefined) return { readOnly: 'a stdio entry that also has url or headers' }
  } else {
    if (typeof c.url !== 'string' || c.url.length === 0) return { readOnly: 'url is not a text' }
    out.url = c.url
    const headers = rowsOf(c.headers, 'headers')
    if (headers.reason !== undefined) return { readOnly: headers.reason }
    out.headers = headers.rows
    if (c.command !== undefined || c.args !== undefined || c.cwd !== undefined || c.env !== undefined) return { readOnly: 'an http entry that also has command, args, cwd or env' }
  }
  return { connecteur: out }
}
