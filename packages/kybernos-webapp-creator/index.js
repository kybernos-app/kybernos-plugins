// ═══════════════════════════════════════════════════════════════════════════
// kybernos-webapp-creator — HOST half.
//
// Create small web apps with a mini SQLite base and run them on this computer.
// The three skills bundled here drive the loop — webapp-brief → webapp-build →
// webapp-publish — and are seeded into <DSH home>/skills at boot, never over a
// file the person may have edited.
//
//   GET  /kybernos-webapp-creator/state              → { ok, apps, problemes }
//   POST /kybernos-webapp-creator/create { nom, slug }
//   POST /kybernos-webapp-creator/start  { slug }
//   POST /kybernos-webapp-creator/stop   { slug }
//   GET  /kybernos-webapp-creator/logs?slug=&n=
//
// Write routes carry DSH's signed session cookie (session-guard.mjs, the shared
// byte-identical copy). Every route sits behind the host fence below. Nothing
// here listens on anything but 127.0.0.1: publishing on *.kaby.app is a later
// batch and gets its own guard.
// ═══════════════════════════════════════════════════════════════════════════

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeGuard } from './session-guard.mjs'
import { appsRoot, discoverApps, findApp, scaffoldApp } from './lib/apps.mjs'
import { readLogs, startApp, statusApp, stopApp } from './lib/runtime.mjs'

// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle
// publishes the predicate (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers
// false and the guard stays loopback-only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
// Host fence (scripts/test-route-hosts.mjs). DSH serves plugin routes BEFORE its own authentication,
// and a page that rebinds its own name to this machine (DNS rebinding) reaches them with its own
// name as Host, no cookie and, on a same-origin GET, no Origin. Every route of this bundle refuses a
// Host that is not this listener's (the port the socket is bound to, on 127.0.0.1 / localhost /
// [::1], or an authority declared with --trusted-host) before its own guard runs. A request with no
// socket (a test) is not judged.
const kbHostOK = (req) => {
  try {
    const host = req.headers !== null && req.headers !== undefined && typeof req.headers.host === 'string' ? req.headers.host : null
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    if (host === null || sock === null || typeof sock.localPort !== 'number') return true
    const port = ':' + sock.localPort
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(host) >= 0 || kbTrusted(host)
  } catch (e) { return false }
}
// What `register` hands back takes the route off again. It is kept here and given to `ctx.effect` by
// `apply`, so that unloading the plugin removes every route it added: without it a hot reload met
// « duplicate exact route » and went on serving the OLD handlers.
const kbRetraits = []
const kbRetirerRoutes = () => { for (const retrait of kbRetraits.splice(0).reverse()) { try { retrait() } catch (e) { /* already gone */ } } }
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
  return new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => { const retrait = target.register(fence(route)); if (typeof retrait === 'function') kbRetraits.push(retrait); return retrait } : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) })
}

export const name = 'kybernos-webapp-creator'

const ICI = dirname(fileURLToPath(import.meta.url))
const SKILLS_SRC = join(ICI, 'skills')
const CORPS_MAX = 8 * 1024

const dire = (msg) => console.log(`[kybernos-webapp-creator] ${msg}`)

const jsonSeulement = (req) => {
  const ct = req.headers !== null && req.headers !== undefined && typeof req.headers['content-type'] === 'string' ? req.headers['content-type'].toLowerCase() : ''
  return ct.indexOf('application/json') === 0
}

const lireCorps = (req, res, cap) => new Promise((resoudre) => {
  const morceaux = []
  let taille = 0
  let fini = false
  const finir = (v) => { if (fini) return; fini = true; morceaux.length = 0; resoudre(v) }
  req.on('data', (d) => {
    if (fini) return
    const o = typeof d === 'string' ? Buffer.from(d) : d
    taille += o.length
    if (taille > cap) {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'request body too large' }))
      finir(null)
      return
    }
    morceaux.push(o)
  })
  req.on('end', () => {
    if (fini) return
    const brut = morceaux.length === 0 ? '' : Buffer.concat(morceaux).toString('utf8')
    try { finir(brut === '' ? {} : JSON.parse(brut)) } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'body is not JSON' }))
      finir(null)
    }
  })
})

const repondreJson = async (res, travail) => {
  try {
    const r = await travail()
    if (res.headersSent === true) return
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(r))
  } catch (e) {
    const motif = String((e && e.message) || e).slice(0, 300)
    dire('route failed: ' + motif)
    if (res.headersSent === true) { try { res.destroy() } catch { /* closed */ } return }
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: motif }))
  }
}

const refuser = (res, refus) => {
  res.writeHead(refus.status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: refus.error }))
}

// ── skills: seeded at boot, never over a file the person may have edited ────
export function seedSkills () {
  const ensemences = []
  try {
    for (const nom of readdirSync(SKILLS_SRC)) {
      const src = join(SKILLS_SRC, nom, 'SKILL.md')
      const dst = join(homedir(), '.dsh', 'skills', nom, 'SKILL.md')
      if (existsSync(src) !== true || existsSync(dst) === true) continue
      mkdirSync(dirname(dst), { recursive: true })
      writeFileSync(dst, readFileSync(src))
      ensemences.push(nom)
    }
    if (ensemences.length > 0) dire('skills seeded: ' + ensemences.join(', '))
  } catch (e) {
    dire('skill seeding skipped: ' + String((e && e.message) || e).slice(0, 120))
  }
  return ensemences
}

// ── route handlers ──────────────────────────────────────────────────────────
const etatDesApps = async () => {
  const racine = appsRoot()
  const { apps, problemes } = discoverApps(racine)
  return { ok: true, root: racine, apps: apps.map((a) => Object.assign({}, a, { statut: statusApp(a.dir) })), problemes }
}

const creerApp = async (corps) => {
  const r = scaffoldApp(appsRoot(), { nom: corps && corps.nom, slug: corps && corps.slug })
  if (r.ok !== true) return { ok: false, error: r.error }
  dire('app scaffolded: ' + r.app.slug)
  return { ok: true, app: r.app }
}

const avecApp = (corps, action) => {
  const slug = corps !== null && corps !== undefined && typeof corps.slug === 'string' ? corps.slug : ''
  const { app } = findApp(slug)
  if (app === null) return { ok: false, error: 'unknown app' }
  return action(app)
}

const demarrer = (corps) => avecApp(corps, (app) => startApp(app.dir))
const arreter = (corps) => avecApp(corps, (app) => stopApp(app.dir))

const lireJournaux = (req) => {
  const u = new URL(req.url, 'http://127.0.0.1')
  const slug = u.searchParams.get('slug') ?? ''
  const n = Math.min(Math.max(Number(u.searchParams.get('n') ?? 50) || 50, 1), 500)
  const { app } = findApp(slug)
  if (app === null) return { ok: false, error: 'unknown app' }
  return { ok: true, slug, lines: readLogs(app.dir, n) }
}

export function apply (ctx) {
  if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') ctx.effect(() => kbRetirerRoutes, 'kybernos-webapp-creator: routes')
  seedSkills()
  const poser = (c) => {
    try {
      const webServerSvc = kbFenced(c.get('webServer'))
      if (webServerSvc === undefined) return
      // Writes: strict same origin + DSH's signed session cookie (session-guard.mjs).
      const ecriture = (travail) => async (req, res) => {
        const refus = writeGuard(req)
        if (refus !== null) { refuser(res, refus); return }
        if (jsonSeulement(req) !== true) { res.writeHead(415, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'application/json content-type expected' })); return }
        const corps = await lireCorps(req, res, CORPS_MAX)
        if (corps === null) return
        await repondreJson(res, () => travail(corps))
      }
      webServerSvc.register({ kind: 'exact', path: '/kybernos-webapp-creator/state', handler: async (_req, res) => { await repondreJson(res, etatDesApps) } })
      webServerSvc.register({ kind: 'exact', path: '/kybernos-webapp-creator/create', handler: ecriture(creerApp) })
      webServerSvc.register({ kind: 'exact', path: '/kybernos-webapp-creator/start', handler: ecriture(demarrer) })
      webServerSvc.register({ kind: 'exact', path: '/kybernos-webapp-creator/stop', handler: ecriture(arreter) })
      webServerSvc.register({ kind: 'exact', path: '/kybernos-webapp-creator/logs', handler: async (req, res) => { await repondreJson(res, async () => lireJournaux(req)) } })
      dire('routes state / create / start / stop / logs mounted')
    } catch (e) {
      dire('routes not mounted: ' + String((e && e.message) || e))
    }
  }
  if (ctx.get('webServer') !== undefined) poser(ctx)
  else ctx.inject(['webServer'], poser)
}
