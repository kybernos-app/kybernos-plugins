// @local/kybernos-dashboards, host half: the `kybernos_dashboard` tool and the routes the Dashboards page and the pane talk to.
// The logic lives in dashboard-host.mjs (pure, tested); this file only wires DSH services to it.
import { existsSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHost, toolOptions, TOOL } from './dashboard-host.mjs'
import { PRESETS } from './presets.mjs'
import { shapeOf, sourcesOf, validateDashboard } from './model.mjs'
import { seedSkills } from './seed-skills.mjs'

export const name = 'kybernos-dashboards'

const here = dirname(fileURLToPath(import.meta.url))
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const ROUTE = '/kybernos-dashboards/'
export const SKILLS_DIR = join(here, 'skills')
export const SEEDED_SKILLS = ['dashboard-builder', 'dashboard-sources']
const dire = (msg) => console.log(`[kybernos-dashboards] ${msg}`)

// Hosted instance: also accept the authorities declared to DSH with --trusted-host (published by the core bundle).
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
const localHosts = (req) => {
  const port = req.socket && typeof req.socket.localPort === 'number' ? ':' + req.socket.localPort : ''
  return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port]
}
// Host fence (scripts/test-route-hosts.mjs). DSH serves plugin routes BEFORE its own authentication, and a page that rebinds its own name
// to this machine (DNS rebinding) reaches them with its own name as Host: every route refuses a Host that is not this listener's.
export const hostOk = (req) => {
  try {
    const host = typeof (req.headers && req.headers.host) === 'string' ? req.headers.host : null
    const sock = req.socket
    if (host === null || sock === null || sock === undefined || typeof sock.localPort !== 'number') return true
    return localHosts(req).includes(host) || kbTrusted(host)
  } catch (e) { return false }
}
/** strict: an Origin or Referer MUST be present and be this page's own. Not strict: when present it must match. */
export const originOk = (req, strict) => {
  try {
    const src = (typeof req.headers.origin === 'string' && req.headers.origin !== '' ? req.headers.origin : null) || (typeof req.headers.referer === 'string' && req.headers.referer !== '' ? req.headers.referer : null)
    if (src === null) return strict === false
    const u = new URL(src)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return localHosts(req).includes(u.host) || kbTrusted(u.host)
  } catch (e) { return false }
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
export const literalDefinition = (o) => ({ name: o.name, description: o.description, parameters: { type: 'object', properties: o.parameters }, output: { schema: {}, render: (args, value) => o.render(args, value) }, execute: o.execute })
export const specDefinition = (o) => ({ name: o.name, description: o.description, parameters: o.parameters, output: { schema: { type: 'json' }, render: (args, value) => o.render(args, value) }, execute: o.execute })

export async function registerTool (tools, host) {
  const options = toolOptions(host)
  const defineTool = await loadDefineTool()
  tools.register(defineTool !== undefined ? defineTool(specDefinition(options)) : literalDefinition(options))
  dire(`tool "${TOOL}" registered`)
}

// ── routes ───────────────────────────────────────────────────────────────────

const send = (res, code, obj) => {
  try {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(obj))
  } catch (e) { /* socket closed */ }
}
async function readJson (req, limit) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > limit) { const e = new Error('too large'); e.code = 'TOO_LARGE'; throw e }
    chunks.push(c)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  const body = JSON.parse(text) // a body that is not JSON throws: the route answers 400
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object')
  return body
}
const isJson = (req) => String((req.headers && req.headers['content-type']) || '').toLowerCase().startsWith('application/json')
const q = (req) => new URL(req.url, 'http://127.0.0.1').searchParams
const str = (v) => (typeof v === 'string' && v !== '' ? v : null)

/** What the page needs to list the presets: their shape, never the whole definition. */
export const presetSummary = () => PRESETS.map((p) => {
  const v = validateDashboard({ name: p.name, desc: p.desc, widgets: p.widgets })
  return { id: p.id, name: p.name, desc: p.desc, widgets: v.dashboard.widgets.length, sources: sourcesOf(v.dashboard).map((s) => s.provider), shape: v.dashboard.widgets.map((w) => shapeOf(w)) }
})

export function mountRoutes (webServer, host) {
  const get = (suffix, run) => webServer.register({ kind: 'exact', path: ROUTE + suffix, handler: async (req, res) => {
    try {
      if (hostOk(req) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
      if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method-not-allowed' })
      if (originOk(req, false) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
      return await run(req, res)
    } catch (e) { dire(`${suffix}: ${e?.message ?? e}`); return send(res, 500, { ok: false, error: 'host-error' }) }
  } })
  const post = (suffix, limit, run) => webServer.register({ kind: 'exact', path: ROUTE + suffix, handler: async (req, res) => {
    try {
      if (hostOk(req) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method-not-allowed' })
      if (originOk(req, true) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
      if (isJson(req) === false) return send(res, 415, { ok: false, error: 'json-required' })
      let body
      try { body = await readJson(req, limit) } catch (e) { return send(res, e && e.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: e && e.code === 'TOO_LARGE' ? 'too-large' : 'bad-body' }) }
      return await run(body, req, res)
    } catch (e) { dire(`${suffix}: ${e?.message ?? e}`); return send(res, 500, { ok: false, error: 'host-error' }) }
  } })

  get('state', (req, res) => {
    // strict: only the dashboard this chat's own tool wrote (the tab opens by itself on that), never a page edit
    const cur = host.getCurrent(str(q(req).get('session')), q(req).get('strict') === '1')
    send(res, 200, { ok: true, current: cur ? { id: cur.id, name: cur.name, at: cur.at } : null, now: Date.now() })
  })
  get('list', async (req, res) => { send(res, 200, { ok: true, ...(await host.list()) }) })
  get('presets', (req, res) => { send(res, 200, { ok: true, presets: presetSummary() }) })
  get('dashboard', async (req, res) => {
    const r = await host.readDoc(str(q(req).get('id')))
    if (!r.ok) return send(res, 404, r)
    const idx = await host.readIndex()
    return send(res, 200, { ok: true, id: r.id, dashboard: r.dashboard, errors: r.errors, rev: r.rev, history: r.history.slice(-12), userEdits: host.userEditsSince(r.history), isDefault: idx.default === r.id })
  })
  get('revisions', async (req, res) => { send(res, 200, { ok: true, revisions: await host.revisions(str(q(req).get('id'))) }) })

  post('save', 500000, async (b, req, res) => {
    if (typeof b.id !== 'string' || b.dashboard === null || typeof b.dashboard !== 'object') return send(res, 400, { ok: false, message: 'id and dashboard are required.' })
    const r = await host.save({ id: b.id, raw: b.dashboard, by: 'user', what: typeof b.what === 'string' ? b.what : 'Edited on the page', expectRev: typeof b.expectRev === 'number' ? b.expectRev : undefined })
    if (r.ok) host.setCurrent(str(b.session) || 'page', r.id, r.dashboard.name)
    return send(res, r.ok ? 200 : (r.conflict ? 409 : 400), r.ok ? { ok: true, rev: r.rev, errors: r.errors } : r)
  })
  post('preset', 4000, async (b, req, res) => {
    const r = await host.fromPreset(str(b.preset), str(b.name) || undefined)
    return send(res, r.ok ? 200 : 400, r.ok ? { ok: true, id: r.id, rev: r.rev } : r)
  })
  post('clone', 4000, async (b, req, res) => {
    const r = await host.clone(str(b.id))
    return send(res, r.ok ? 200 : 404, r.ok ? { ok: true, id: r.id, rev: r.rev } : r)
  })
  post('flags', 4000, async (b, req, res) => {
    const patch = {}
    for (const k of ['hidden', 'archived', 'default']) if (typeof b[k] === 'boolean') patch[k] = b[k]
    const r = await host.setFlags(str(b.id), patch)
    return send(res, r.ok ? 200 : 404, r)
  })
  post('open', 4000, async (b, req, res) => {
    const r = await host.readDoc(str(b.id))
    if (!r.ok) return send(res, 404, r)
    host.setCurrent(str(b.session) || 'page', r.id, r.dashboard.name)
    return send(res, 200, { ok: true, id: r.id })
  })
  post('restore', 4000, async (b, req, res) => {
    const r = await host.restore(str(b.id), b.rev)
    return send(res, r.ok ? 200 : 404, r.ok ? { ok: true, rev: r.rev } : r)
  })
  dire('routes mounted')
}

// ── the bundle ───────────────────────────────────────────────────────────────

export function apply (ctx) {
  try {
    const host = createHost({ fs: fsp, home: DSH_HOME, log: dire })
    try {
      for (const r of seedSkills({ home: DSH_HOME, sourceDir: SKILLS_DIR, names: SEEDED_SKILLS })) {
        if (r.error) dire(`skill ${r.name}: ${r.error}`)
      }
    } catch (e) { dire(`skills not seeded: ${e?.message ?? e}`) }
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
    console.log('[kybernos-dashboards] disabled: ' + String(e?.message ?? e))
  }
}
