// kybernos-multi-device — host logic. Pure: every I/O (disk, platform, clock) is injected, so
// test-host.mjs plays it without DSH. No @deepseek-ai/* import: a plugin linked as @local/… cannot resolve them.
//
// What the host does in v1: one thing. A project without a folder still needs a folder (DSH's workspace IS a
// directory), so the host creates one for the person, under <Documents>/Kybernos/<name>, visible in the Finder.
//
//   GET  /kybernos-multi-device/status          → { ok, root, rootDisplay }
//   POST /kybernos-multi-device/private-folder  → { name } → { ok, name, path }
//
// The route never takes a path from the page: it takes a NAME, checks it, and joins it under a root it computes itself.
import { isAbsolute, join, relative, sep } from 'node:path'

// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle publishes the predicate
// (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers false and the guard stays loopback-only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
// Host fence (scripts/test-route-hosts.mjs). DSH serves plugin routes BEFORE its own authentication, and a page that rebinds its own name to this
// machine (DNS rebinding) reaches them with its own name as Host, no cookie and, on a same-origin GET, no Origin. Every route of this bundle refuses a
// Host that is not this listener's (the port the socket is bound to, on 127.0.0.1 / localhost / [::1], or an authority declared with --trusted-host)
// before its own guard runs. A request with no socket (a test) is not judged.
const kbHostOK = (req) => {
  try {
    const host = req.headers !== null && req.headers !== undefined && typeof req.headers.host === 'string' ? req.headers.host : null
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    if (host === null || sock === null || typeof sock.localPort !== 'number') return true
    const port = ':' + sock.localPort
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(host) >= 0 || kbTrusted(host)
  } catch (e) { return false }
}
const kbFenced = (service) => {
  if (service === null || service === undefined || typeof service.register !== 'function') return service
  const fence = (route) => (route !== null && typeof route === 'object' && typeof route.handler === 'function'
    ? Object.assign({}, route, {
      handler: (req, res, ...rest) => {
        if (kbHostOK(req) !== true) {
          try { res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' }); res.end('{"ok":false,"error":"origin refused"}') } catch (e) { /* closed */ }
          return undefined
        }
        return route.handler(req, res, ...rest)
      },
    })
    : route)
  return new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => target.register(fence(route)) : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) })
}

// ── Origin guard: compare with the REAL socket address, never with the client-supplied Host. ──
const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null)
const hotesLocaux = (req) => {
  const port = typeof req?.socket?.localPort === 'number' ? ':' + req.socket.localPort : ''
  return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port]
}
const origineOk = (req, strict) => {
  try {
    const source = str(req?.headers?.origin) ?? str(req?.headers?.referer)
    if (source === null) return strict === false
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return (hotesLocaux(req).includes(u.host) || kbTrusted(u.host))
  } catch { return strict === false }
}
export const sameOriginStrict = (req) => origineOk(req, true)
export const sameOriginLax = (req) => origineOk(req, false)

const send = (res, status, payload) => {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  } catch { /* socket closed */ }
}

const readBody = async (req, cap = 2048) => {
  let size = 0
  const chunks = []
  for await (const c of req) { size += c.length; if (size > cap) throw new Error('too-large'); chunks.push(c) }
  return chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

// ── The name of a private folder (it is also the project's title: DSH titles a workspace after its folder). ──
export const NAME_MAX = 80
const FORBIDDEN = /[\u0000-\u001f\u007f/\\:*?"<>|]/
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/**
 * @param {unknown} raw
 * @returns {{ ok: true, name: string } | { ok: false, reason: 'empty' | 'too-long' | 'forbidden-char' | 'dots' | 'reserved' }}
 */
export function validName (raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' }
  const nfc = raw.normalize('NFC')
  // Control characters (a newline, a tab) are refused as typed: collapsing them into a space would hide a pasted multi-line value.
  if (FORBIDDEN.test(nfc)) return { ok: false, reason: 'forbidden-char' }
  const name = nfc.replace(/ +/g, ' ').trim()
  if (name === '') return { ok: false, reason: 'empty' }
  if (name.length > NAME_MAX) return { ok: false, reason: 'too-long' }
  if (name.startsWith('.') || name.endsWith('.')) return { ok: false, reason: 'dots' }
  if (RESERVED.test(name)) return { ok: false, reason: 'reserved' }
  return { ok: true, name }
}

/**
 * Where "Documents" is. Same idea as DSH's first-use directory: the system Documents folder, or ~/Documents.
 * @param {{ platform: string, home: string, env: Record<string, string | undefined>, xdgDocuments?: () => string | null }} deps
 */
export function documentsDir (deps) {
  const override = deps.env.KYBERNOS_DOCUMENTS_DIR
  if (typeof override === 'string' && isAbsolute(override)) return override
  if (deps.platform === 'linux' && typeof deps.xdgDocuments === 'function') {
    let x = null
    try { x = deps.xdgDocuments() } catch (e) { x = null }
    // xdg-user-dir answers $HOME when Documents is not configured: that is not a Documents folder.
    if (typeof x === 'string' && isAbsolute(x) && x.replace(/[\\/]+$/, '') !== deps.home.replace(/[\\/]+$/, '')) return x
  }
  return join(deps.home, 'Documents')
}

export const rootOf = (documents) => join(documents, 'Kybernos')

/** `~`-abbreviated path for display (never for logic). */
export function display (path, home) {
  const h = String(home).replace(/[\\/]+$/, '')
  if (h !== '' && (path === h || path.startsWith(h + sep) || path.startsWith(h + '/'))) return '~' + path.slice(h.length).split(sep).join('/')
  return path
}

/**
 * Create <root>/<name>. The leaf is created WITHOUT `recursive`, so an existing folder is reported, never reused.
 * @param {{ name: unknown, documents: string, io: { mkdir: (p: string, opts?: object) => void } }} a
 */
export function createPrivateFolder ({ name, documents, io }) {
  const v = validName(name)
  if (!v.ok) return { status: 400, body: { ok: false, error: 'bad-name', reason: v.reason } }
  const root = rootOf(documents)
  const target = join(root, v.name)
  // Defence in depth: whatever the name was, the target must be a direct child of the root.
  const rel = relative(root, target)
  if (rel !== v.name || rel.includes(sep) || rel === '..' || rel.startsWith('..')) return { status: 400, body: { ok: false, error: 'bad-name', reason: 'forbidden-char' } }
  try {
    io.mkdir(root, { recursive: true })
    io.mkdir(target)
  } catch (e) {
    const code = e && typeof e === 'object' ? e.code : undefined
    if (code === 'EEXIST') return { status: 409, body: { ok: false, error: 'exists', name: v.name, path: target } }
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return { status: 403, body: { ok: false, error: 'not-allowed' } }
    return { status: 500, body: { ok: false, error: 'mkdir-failed' } }
  }
  return { status: 200, body: { ok: true, name: v.name, path: target } }
}

/**
 * @param {object} webServer the DSH web server service
 * @param {{ documents: () => string, home: () => string, mkdir: (p: string, opts?: object) => void }} deps
 * @param {{ effect?: (fn: () => void, label: string) => unknown }} [links]
 */
export function monterRoutes (webServer, deps, links = {}) {
  webServer = kbFenced(webServer)
  const status = (req, res) => {
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method-not-allowed' })
    if (sameOriginLax(req) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
    const root = rootOf(deps.documents())
    return send(res, 200, { ok: true, version: 1, root, rootDisplay: display(root, deps.home()) })
  }
  const privateFolder = async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method-not-allowed' })
    if (sameOriginStrict(req) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
    if (!String(req.headers?.['content-type'] ?? '').toLowerCase().startsWith('application/json')) return send(res, 415, { ok: false, error: 'json-required' })
    let body
    try { body = await readBody(req) } catch { return send(res, 400, { ok: false, error: 'bad-body' }) }
    const out = createPrivateFolder({ name: body?.name, documents: deps.documents(), io: { mkdir: deps.mkdir } })
    return send(res, out.status, out.status === 200 ? { ...out.body, display: display(out.body.path, deps.home()) } : out.body)
  }
  const register = () => {
    webServer.register({ kind: 'exact', path: '/kybernos-multi-device/status', handler: status })
    webServer.register({ kind: 'exact', path: '/kybernos-multi-device/private-folder', handler: privateFolder })
  }
  return typeof links.effect === 'function' ? links.effect(register, 'kybernos-multi-device: routes') : register()
}
