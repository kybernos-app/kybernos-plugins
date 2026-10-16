// @local/kybernos-motion, host half: the `creer_motion` tool and the routes the panel talks to.
// The logic lives in motion-host.mjs (pure, tested); this file only wires DSH services to it.
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, readFileSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { TOOL, createHost, toolOptions, EXT, LIMITS } from './motion-host.mjs'

export const name = 'kybernos-motion'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const ROUTE = '/kybernos-motion/'
const dire = (msg) => console.log(`[kybernos-motion] ${msg}`)

// Hosted instance: also accept the authorities declared to DSH with --trusted-host (published by the core bundle).
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
// Host fence (scripts/test-route-hosts.mjs). DSH serves plugin routes BEFORE its own authentication, and a page that rebinds its own name to this machine
// (DNS rebinding) reaches them with its own name as Host, no cookie and, on a same-origin GET, no Origin (a browser sends none): a guard that looks at the
// Origin alone lets every read through. Every route of this bundle refuses a Host that is not this listener's (the port the socket is bound to, on
// 127.0.0.1 / localhost / [::1], or an authority declared with --trusted-host) before its own guard runs. A request with no socket (a test) is not judged.
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

// The core plugin publishes how to find a session's folder and whether a path is one a session may use.
// Read on every call: the core may load after this bundle, and without it Motion still works in its own store.
const workspace = {
  sessionCwd: async (id) => { const w = globalThis[Symbol.for('kybernos.workspace')]; return w && typeof w.sessionCwd === 'function' ? w.sessionCwd(id) : null },
  pathAllowed: async (p, o) => { const w = globalThis[Symbol.for('kybernos.workspace')]; return w && typeof w.pathAllowed === 'function' ? w.pathAllowed(p, o) : false },
}

// ── tool registration (same recipe as the other tool-carrying bundles) ──────
const CANDIDATS_DSH_TOOLS = [
  join(DSH_HOME, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
  '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
]

async function loadDefineTool () {
  for (const chemin of CANDIDATS_DSH_TOOLS) {
    if (!existsSync(chemin)) continue
    try {
      const m = await import(chemin)
      if (typeof m?.defineTool === 'function') return m.defineTool
    } catch (e) { dire(`defineTool unreadable from ${chemin}: ${e?.message ?? e}`) }
  }
  return undefined
}

/** The exact shape defineTool produces, for when dsh-tools cannot be imported. */
export function literalDefinition (o) {
  return { name: o.name, description: o.description, parameters: { type: 'object', properties: o.parameters }, output: { schema: {}, render: (args, value) => o.render(args, value) }, execute: o.execute }
}
export function specDefinition (o) {
  return { name: o.name, description: o.description, parameters: o.parameters, output: { schema: { type: 'json' }, render: (args, value) => o.render(args, value) }, execute: o.execute }
}

export async function registerTool (tools, host) {
  const options = toolOptions(host)
  const defineTool = await loadDefineTool()
  tools.register(defineTool !== undefined ? defineTool(specDefinition(options)) : literalDefinition(options))
  dire(`tool "${TOOL}" registered`)
}

// ── routes ───────────────────────────────────────────────────────────────────

const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

/** Same page only: the exact host of the socket's real listening address, never a prefix (routes answer before DSH's own auth). */
export const sameOrigin = (req) => {
  const o = String(req.headers.origin || '')
  if (o === '') return true
  try {
    const u = new URL(o)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const port = req.socket && typeof req.socket.localPort === 'number' ? ':' + req.socket.localPort : ''
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host)
  } catch { return false }
}

async function readBody (req, limit) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > limit) { const e = new Error('too large'); e.code = 'TOO_LARGE'; throw e }
    chunks.push(c)
  }
  return Buffer.concat(chunks)
}

async function readJson (req, limit = LIMITS.doc + 10_000) {
  const b = await readBody(req, limit)
  try { return JSON.parse(b.toString('utf8') || '{}') } catch { return {} }
}

// The two big libraries (three.js, lottie-web) are not in client.js: they are fetched only when a scene needs them.
// Fixed names, files that ship with this bundle, nothing taken from the request.
const VENDOR = { three: 'three.iife.js', lottie: 'lottie-canvas.min.js' }
const vendorCache = new Map()
function vendorFile (name) {
  if (!vendorCache.has(name)) {
    const buf = readFileSync(new URL('./vendor/' + VENDOR[name], import.meta.url))
    vendorCache.set(name, { buf, etag: '"' + createHash('sha1').update(buf).digest('hex').slice(0, 20) + '"' })
  }
  return vendorCache.get(name)
}

const q = (req) => new URL(req.url, 'http://127.0.0.1').searchParams
const str = (v) => (typeof v === 'string' && v !== '' ? v : null)

export function mountRoutes (webServer, host) {
  webServer = kbFenced(webServer)
  const route = (suffix, methods, handler) => webServer.register({
    kind: 'exact',
    path: ROUTE + suffix,
    handler: async (req, res) => {
      try {
        if (!methods.includes(req.method)) { res.writeHead(405); res.end(`${methods.join(' or ')} only`); return }
        if (!sameOrigin(req)) { res.writeHead(403); res.end('origin refused'); return }
        await handler(req, res)
      } catch (e) {
        if (e && e.code === 'TOO_LARGE') { send(res, 413, { ok: false, message: 'Too large.' }); return }
        dire(`${suffix}: ${e?.message ?? e}`)
        if (!res.headersSent) send(res, 500, { ok: false, message: 'Something went wrong on the host.' })
      }
    },
  })

  route('state', ['GET'], async (req, res) => {
    const session = q(req).get('session')
    let cur = host.getCurrent(session)
    // A remembered scene this session may not read (another workspace's, or a folder that is gone) is not this session's: the panel
    // shows its empty state, not a red error and a refused request every poll.
    if (cur !== null && cur !== undefined && !(await host.confineExisting(cur.path, str(session))).ok) cur = null
    send(res, 200, { ok: true, current: cur ? { path: cur.path, title: cur.title, at: cur.at } : null, frame: host.pendingFrame(session), now: Date.now() })
  })

  route('scene', ['GET'], async (req, res) => {
    const c = await host.confineExisting(str(q(req).get('path')), str(q(req).get('session')))
    if (!c.ok) { send(res, 403, c); return }
    const r = await host.readDoc(c.path)
    if (!r.ok) { send(res, 404, r); return }
    const { _n, ...scene } = r.scene
    const hist = Array.isArray(r.doc.meta && r.doc.meta.history) ? r.doc.meta.history : []
    send(res, 200, { ok: true, path: c.path, title: r.doc.title, rev: r.doc.meta.rev, scene, errors: r.errors, history: hist.slice(-12), userEdits: host.userEditsSince(r.doc) })
  })

  route('save', ['POST'], async (req, res) => {
    const b = await readJson(req)
    const c = await host.confineExisting(str(b.path), str(b.session))
    if (!c.ok) { send(res, 403, c); return }
    if (b.scene === null || typeof b.scene !== 'object') { send(res, 400, { ok: false, message: 'A scene is required.' }); return }
    const r = await host.saveScene({ path: c.path, rawScene: b.scene, by: 'user', what: typeof b.what === 'string' ? b.what : 'Edited in the panel', title: typeof b.title === 'string' ? b.title : undefined })
    if (!r.ok) { send(res, 400, r); return }
    host.setCurrent(str(b.session) || 'panel', c.path, r.title)
    send(res, 200, { ok: true, rev: r.rev, title: r.title, errors: r.errors })
  })

  route('open', ['POST'], async (req, res) => {
    const b = await readJson(req, 20_000)
    const c = await host.confineExisting(str(b.path), str(b.session))
    if (!c.ok) { send(res, 403, c); return }
    const r = await host.readDoc(c.path)
    if (!r.ok) { send(res, 404, r); return }
    host.setCurrent(str(b.session) || 'panel', c.path, r.doc.title)
    send(res, 200, { ok: true, path: c.path, title: r.doc.title })
  })

  route('list', ['GET'], async (req, res) => {
    send(res, 200, { ok: true, scenes: await host.listScenes(str(q(req).get('session'))) })
  })

  route('revisions', ['GET'], async (req, res) => {
    const c = await host.confineExisting(str(q(req).get('path')), str(q(req).get('session')))
    if (!c.ok) { send(res, 403, c); return }
    send(res, 200, { ok: true, revisions: await host.revisions(c.path) })
  })

  route('restore', ['POST'], async (req, res) => {
    const b = await readJson(req, 20_000)
    const c = await host.confineExisting(str(b.path), str(b.session))
    if (!c.ok) { send(res, 403, c); return }
    const r = await host.restore(c.path, b.rev)
    send(res, r.ok ? 200 : 404, r.ok ? { ok: true, rev: r.rev, title: r.title } : r)
  })

  route('asset', ['GET'], async (req, res) => {
    const p = q(req)
    const a = await host.resolveAsset(str(p.get('scene')), str(p.get('src')), str(p.get('session')))
    if (!a.ok) { send(res, 404, a); return }
    res.writeHead(200, { 'Content-Type': a.type, 'Content-Length': a.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    const { createReadStream } = await import('node:fs')
    createReadStream(a.path).pipe(res)
  })

  for (const name of Object.keys(VENDOR)) {
    route(`vendor/${name}.js`, ['GET'], async (req, res) => {
      const f = vendorFile(name)
      if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, { ETag: f.etag }); res.end(); return }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': f.buf.length, 'Cache-Control': 'no-cache', ETag: f.etag, 'X-Content-Type-Options': 'nosniff' })
      res.end(f.buf)
    })
  }

  route('frame', ['POST'], async (req, res) => {
    const p = q(req)
    const body = await readBody(req, LIMITS.png)
    const r = await host.deliverFrame(str(p.get('session')), str(p.get('id')), new Uint8Array(body))
    send(res, r.ok ? 200 : 409, r)
  })

  // An exported video, written next to its scene (artifacts/ is where Livrables lists media).
  route('export', ['POST'], async (req, res) => {
    const p = q(req)
    const ext = { mp4: '.mp4', webm: '.webm' }[p.get('format')]
    if (ext === undefined) { send(res, 400, { ok: false, message: 'format must be mp4 or webm.' }); return }
    const c = await host.confineExisting(str(p.get('path')), str(p.get('session')))
    if (!c.ok) { send(res, 403, c); return }
    const stem = basename(c.path, EXT)
    let target = join(dirname(c.path), stem + ext)
    for (let i = 2; existsSync(target) && i < 1000; i++) target = join(dirname(c.path), `${stem}-${i}${ext}`)
    const tmp = `${target}.${process.pid}.tmp`
    let size = 0
    try {
      await new Promise((resolve, reject) => {
        const out = createWriteStream(tmp)
        out.on('error', reject)
        out.on('finish', resolve)
        req.on('error', reject)
        req.on('data', (chunk) => {
          size += chunk.length
          if (size > LIMITS.export) { const e = new Error('too large'); e.code = 'TOO_LARGE'; req.unpipe(out); out.destroy(); reject(e) }
        })
        req.pipe(out)
      })
      if (size < 16) throw Object.assign(new Error('empty'), { code: 'EMPTY' })
      await fsp.rename(tmp, target)
    } catch (e) {
      await fsp.rm(tmp, { force: true }).catch(() => {})
      if (e && e.code === 'TOO_LARGE') { send(res, 413, { ok: false, message: 'The video is over 400 MB.' }); return }
      if (e && e.code === 'EMPTY') { send(res, 400, { ok: false, message: 'Nothing was received.' }); return }
      throw e
    }
    send(res, 200, { ok: true, path: target, name: basename(target), size })
  })

  dire('routes mounted')
}

// ── the bundle ──────────────────────────────────────────────────────────────

export function apply (ctx) {
  try {
    const host = createHost({ fs: fsp, home: DSH_HOME, workspace, log: dire })
    const start = (c) => {
      const tools = c.get('tools')
      const webServer = c.get('webServer')
      if (tools !== undefined) registerTool(tools, host).catch((e) => dire(`tool not registered: ${e?.message ?? e}`))
      if (webServer !== undefined) {
        try { mountRoutes(webServer, host) } catch (e) { dire(`routes not mounted: ${e?.message ?? e}`) }
      }
    }
    if (ctx.get('tools') !== undefined && ctx.get('webServer') !== undefined) start(ctx)
    else ctx.inject(['tools', 'webServer'], start)
  } catch (e) {
    console.log('[kybernos-motion] disabled: ' + String(e?.message ?? e))
  }
}
