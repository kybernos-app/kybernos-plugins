// ═══════════════════════════════════════════════════════════════════════════
// kybernos-miniapps — HOST half.
//
// « Install as app » for the mini-apps of the right sidebar
// (Bricks, Modeler, Slides…): the panel is exported as a standalone page,
// and the host puts it in a small floating native macOS app (the bundle's
// Swift template), with an optional LaunchAgent to start it automatically.
//
//   POST /kybernos-miniapps/install   { id, titre, html, largeur, hauteur, auto }
//   POST /kybernos-miniapps/uninstall { id }
//   GET  /kybernos-miniapps/list
//
// The HTML comes from the client, which serialises the panel (DOM + styles +
// canvases frozen as images). It is therefore a SNAPSHOT: a mini-app that talks
// to the server live (animated replay) will live frozen outside DSH — accepted.
//
// macOS only (NSPanel + codesign + launchctl). Elsewhere: a polite refusal.
// ═══════════════════════════════════════════════════════════════════════════

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { writeGuard } from './session-guard.mjs'
// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle publishes the predicate
// (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers false and the guard stays loopback-only.
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

export const name = 'kybernos-miniapps'

const ICI = dirname(fileURLToPath(import.meta.url))
const TEMPLATE = join(ICI, 'template', 'template.app')
const DEST_ROOT = join(homedir(), 'Applications', 'Kybernos')
const AGENTS = join(homedir(), 'Library', 'LaunchAgents')
const MACOS = process.platform === 'darwin'

const dire = (msg) => console.log(`[kybernos-miniapps] ${msg}`)

const slug = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'miniapp'

const executer = (cmd, args) => new Promise((resoudre) => {
  try {
    execFile(cmd, args, { timeout: 15_000 }, (err, stdout, stderr) => resoudre({ err, stdout, stderr }))
  } catch (err) { resoudre({ err }) }
})

// ── write guard (2026-10 acceptance M-02/S-03, see kybernos-slides) ─────────
// M-03: install/uninstall write AND launch a native app — a cross-site (drive-by)
// POST must never get there, nor a local program that sends no header at all:
// `writeGuard` (session-guard.mjs, the terminal's rule) requires the EXACT
// origin of the socket's real listener AND DSH's signed session cookie. Their
// only caller is the page (a browser).

// M-03: the POSTs that act require explicit JSON — a text/plain POST (the
// simple cross-site form, no preflight) is refused.
const jsonSeulement = (req) => {
  const ct = String(req.headers['content-type'] || '').toLowerCase()
  return ct.includes('application/json')
}

// M-03: the write path stays UNDER DEST_ROOT — an app name must never escape
// (no '.' segment, no traversal after resolution).
const nomAppSur = (nomApp) => {
  if (nomApp.startsWith('.') || nomApp.includes('/')) return false
  const cible = resolve(DEST_ROOT, nomApp + '.app')
  const racine = resolve(DEST_ROOT) + sep
  return cible.startsWith(racine)
}

// ── install ─────────────────────────────────────────────────────────────────
async function installer (corps) {
  if (!MACOS) return { ok: false, erreur: 'Installing a widget app is macOS only.' }
  const id = slug(corps.id)
  const titre = String(corps.titre || 'MiniApp Kybernos').slice(0, 60)
  const html = String(corps.html || '')
  if (html.length < 10) return { ok: false, erreur: 'HTML too short.' }
  if (html.length > 4_000_000) return { ok: false, erreur: 'HTML too large.' }
  const largeur = Math.max(180, Math.min(600, Number(corps.largeur) || 260))
  const hauteur = Math.max(180, Math.min(800, Number(corps.hauteur) || 340))

  mkdirSync(DEST_ROOT, { recursive: true })
  const nomApp = `${titre.replace(/[^\p{L}\p{N} .-]/gu, '').trim() || 'MiniApp'} ${id}`.slice(0, 80)
  if (!nomAppSur(nomApp)) return { ok: false, erreur: 'app name refused (outside the install folder).' }
  const appDir = join(DEST_ROOT, `${nomApp}.app`)

  // start from scratch on a reinstall
  try { rmSync(appDir, { recursive: true, force: true }) } catch { /* absent */ }
  mkdirSync(join(appDir, 'Contents', 'MacOS'), { recursive: true })
  mkdirSync(join(appDir, 'Contents', 'Resources'), { recursive: true })

  // binary + plist from the bundle's template
  // (chmod 0755: writeFileSync sets 0644 and without the executable bit
  // LaunchServices refuses to launch — spawn error 111)
  const binaire = join(appDir, 'Contents', 'MacOS', 'miniapp')
  writeFileSync(binaire, readFileSync(join(TEMPLATE, 'Contents', 'MacOS', 'miniapp')))
  chmodSync(binaire, 0o755)
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>${titre.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>
<key>CFBundleIdentifier</key><string>app.kybernos.miniapps.${id}</string>
<key>CFBundleVersion</key><string>1.0</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleExecutable</key><string>miniapp</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
<key>LSUIElement</key><true/>
<key>KBWindowWidth</key><integer>${largeur}</integer>
<key>KBWindowHeight</key><integer>${hauteur}</integer>
<key>KBTitle</key><string>${titre.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>
</dict></plist>
`
  writeFileSync(join(appDir, 'Contents', 'Info.plist'), plist)
  writeFileSync(join(appDir, 'Contents', 'Resources', 'index.html'), html)

  const signature = await executer('/usr/bin/codesign', ['-f', '-s', '-', appDir])
  if (signature.err) {
    dire(`codesign failed: ${signature.err.message ?? signature.err}`)
    return { ok: false, erreur: 'Cannot sign the app (codesign).' }
  }

  // optional LaunchAgent — « Launch automatically »
  let auto = false
  if (corps.auto === true) {
    auto = true
    mkdirSync(AGENTS, { recursive: true })
    const agent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>app.kybernos.miniapps.${id}</string>
<key>ProgramArguments</key><array><string>${appDir}/Contents/MacOS/miniapp</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><false/>
</dict></plist>
`
    const agentPlist = join(AGENTS, `app.kybernos.miniapps.${id}.plist`)
    writeFileSync(agentPlist, agent)
    await executer('/bin/launchctl', ['unload', agentPlist])
    await executer('/bin/launchctl', ['load', agentPlist])
  }

  // launch right away
  const lancee = await executer('/usr/bin/open', [appDir])
  dire(`installed: ${appDir}${auto ? ' (launch at login)' : ''}`)
  return { ok: true, chemin: appDir, auto, lancee: !lancee.err }
}

// ── uninstall ───────────────────────────────────────────────────────────────
async function desinstaller (corps) {
  const id = slug(corps.id)
  let retire = []
  if (existsSync(DEST_ROOT)) {
    for (const ent of readdirSync(DEST_ROOT)) {
      if (!ent.endsWith('.app')) continue
      const bundleId = await lireBundleId(join(DEST_ROOT, ent))
      if (bundleId === `app.kybernos.miniapps.${id}`) {
        await executer('/usr/bin/pkill', ['-f', `app.kybernos.miniapps.${id}`])
        try { rmSync(join(DEST_ROOT, ent), { recursive: true, force: true }); retire.push(ent) } catch { /* rien */ }
      }
    }
  }
  const agentPlist = join(AGENTS, `app.kybernos.miniapps.${id}.plist`)
  if (existsSync(agentPlist)) {
    await executer('/bin/launchctl', ['unload', agentPlist])
    try { rmSync(agentPlist, { force: true }); retire.push(`${id}.plist`) } catch { /* rien */ }
  }
  dire(`uninstalled: ${retire.join(', ') || 'nothing'}`)
  return { ok: true, retire }
}

async function lireBundleId (appDir) {
  const r = await executer('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', join(appDir, 'Contents', 'Info.plist')])
  return r.err ? '' : String(r.stdout || '').trim()
}

// ── list ────────────────────────────────────────────────────────────────────
async function lister () {
  const items = []
  if (existsSync(DEST_ROOT)) {
    for (const ent of readdirSync(DEST_ROOT)) {
      if (!ent.endsWith('.app')) continue
      const appDir = join(DEST_ROOT, ent)
      const id = await lireBundleId(appDir)
      if (!id.startsWith('app.kybernos.miniapps.')) continue
      items.push({
        id: id.slice('app.kybernos.miniapps.'.length),
        chemin: appDir,
        auto: existsSync(join(AGENTS, `${id}.plist`)),
      })
    }
  }
  return { ok: true, macos: MACOS, items }
}

// ── plugin ──────────────────────────────────────────────────────────────────
// Services are read through `ctx.get` (never `ctx.<name>` before the inject
// has resolved): the form that works in cordis as well as in a test context
// that only carries `get` (same pattern as kybernos-slides).
// The request body is read by hand (no body parser on these routes —
// same event-based reading as kybernos-slides).
const lireCorps = (req) => new Promise((res) => {
  let corps = ''
  req.on('data', (d) => { corps += d })
  req.on('end', () => { try { res(JSON.parse(corps || '{}')) } catch { res({}) } })
})

export function apply (ctx) {
  const poser = (c) => {
    try {
      const webServerSvc = kbFenced(c.get('webServer'))
      if (webServerSvc === undefined) return
      webServerSvc.register({ kind: 'exact', path: '/kybernos-miniapps/install', handler: async (req, res) => {
        // M-03: writes + launches a native app — exact origin, signed session and JSON required.
        const refus = writeGuard(req)
        if (refus !== null) { res.writeHead(refus.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: refus.error })); return }
        if (!jsonSeulement(req)) { res.writeHead(415); res.end('application/json content-type expected'); return }
        const r = await installer(await lireCorps(req))
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(r))
      } })
      webServerSvc.register({ kind: 'exact', path: '/kybernos-miniapps/uninstall', handler: async (req, res) => {
        const refus = writeGuard(req)
        if (refus !== null) { res.writeHead(refus.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: refus.error })); return }
        if (!jsonSeulement(req)) { res.writeHead(415); res.end('application/json content-type expected'); return }
        const r = await desinstaller(await lireCorps(req))
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(r))
      } })
      webServerSvc.register({ kind: 'exact', path: '/kybernos-miniapps/list', handler: async (_req, res) => {
        const r = await lister()
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(r))
      } })
      dire('routes install / uninstall / list mounted')
    } catch (e) {
      dire(`routes not mounted: ${e?.message ?? e}`)
    }
  }
  if (ctx.get('webServer') !== undefined) poser(ctx)
  else ctx.inject(['webServer'], poser)
}
