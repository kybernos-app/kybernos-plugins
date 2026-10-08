// ═══════════════════════════════════════════════════════════════════════════
// kybernos-miniapps — moitié HÔTE.
//
// « Install as app » pour les mini-apps de la barre latérale droite
// (Briques, Modeleur, Slides…) : le panneau s'exporte en page autonome,
// l'hôte la pose dans une petite app native macOS flottante (template Swift
// du bundle), avec LaunchAgent optionnel pour le démarrage automatique.
//
//   POST /kybernos-miniapps/install   { id, titre, html, largeur, hauteur, auto }
//   POST /kybernos-miniapps/uninstall { id }
//   GET  /kybernos-miniapps/list
//
// Le HTML vient du client, qui sérialise le panneau (DOM + styles + canvas
// figés en images). C'est donc un INSTANTANÉ : une mini-app qui parle au
// serveur en direct (relecture animée) vivra figée hors DSH — assumé.
//
// macOS uniquement (NSPanel + codesign + launchctl). Ailleurs : refus poli.
// ═══════════════════════════════════════════════════════════════════════════

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle publishes the predicate
// (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers false and the guard stays loopback-only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }

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

// ── garde d'origine (recette 2026-10 M-02/S-03, cf. kybernos-slides) ────────
// M-03 : install/uninstall écrivent ET lancent une app native — un POST
// cross-site (drive-by) ne doit jamais y arriver. Hôte EXACT de l'écoute
// réelle du socket, jamais un préfixe.
const origineOK = (req) => {
  const o = String(req.headers.origin || '')
  if (o === '') return true
  try {
    const u = new URL(o)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const port = (req.socket && typeof req.socket.localPort === 'number') ? ':' + req.socket.localPort : ''
    return (['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host))
  } catch { return false }
}

// M-03 : les POST qui agissent exigent du JSON explicite — un POST text/plain
// (forme simple cross-site sans préflight) est refusé.
const jsonSeulement = (req) => {
  const ct = String(req.headers['content-type'] || '').toLowerCase()
  return ct.includes('application/json')
}

// M-03 : le chemin d'écriture reste SOUS DEST_ROOT — un nom d'app ne doit
// jamais s'échapper (pas de segment '.', pas de traversal après résolution).
const nomAppSur = (nomApp) => {
  if (nomApp.startsWith('.') || nomApp.includes('/')) return false
  const cible = resolve(DEST_ROOT, nomApp + '.app')
  const racine = resolve(DEST_ROOT) + sep
  return cible.startsWith(racine)
}

// ── install ─────────────────────────────────────────────────────────────────
async function installer (corps) {
  if (!MACOS) return { ok: false, erreur: 'L’installation d’app widget est macOS seulement.' }
  const id = slug(corps.id)
  const titre = String(corps.titre || 'MiniApp Kybernos').slice(0, 60)
  const html = String(corps.html || '')
  if (html.length < 10) return { ok: false, erreur: 'HTML trop court.' }
  if (html.length > 4_000_000) return { ok: false, erreur: 'HTML trop volumineux.' }
  const largeur = Math.max(180, Math.min(600, Number(corps.largeur) || 260))
  const hauteur = Math.max(180, Math.min(800, Number(corps.hauteur) || 340))

  mkdirSync(DEST_ROOT, { recursive: true })
  const nomApp = `${titre.replace(/[^\p{L}\p{N} .-]/gu, '').trim() || 'MiniApp'} ${id}`.slice(0, 80)
  if (!nomAppSur(nomApp)) return { ok: false, erreur: 'nom d’app refusé (hors dossier d’installation).' }
  const appDir = join(DEST_ROOT, `${nomApp}.app`)

  // repartir de zéro si réinstall
  try { rmSync(appDir, { recursive: true, force: true }) } catch { /* absent */ }
  mkdirSync(join(appDir, 'Contents', 'MacOS'), { recursive: true })
  mkdirSync(join(appDir, 'Contents', 'Resources'), { recursive: true })

  // binaire + plist depuis le template du bundle
  // (chmod 0755 : writeFileSync pose 0644 et sans le bit exécutable
  // LaunchServices refuse le lancement — spawn error 111)
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
    dire(`codesign a échoué : ${signature.err.message ?? signature.err}`)
    return { ok: false, erreur: 'Signature de l’app impossible (codesign).' }
  }

  // LaunchAgent optionnel — « Launch automatically »
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

  // lancer tout de suite
  const lancee = await executer('/usr/bin/open', [appDir])
  dire(`installée : ${appDir}${auto ? ' (démarrage auto)' : ''}`)
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
  dire(`désinstallée : ${retire.join(', ') || 'rien'}`)
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
  return { ok: true, items }
}

// ── plugin ──────────────────────────────────────────────────────────────────
// Les services sont lus par `ctx.get` (jamais `ctx.<nom>` avant que l'inject
// n'ait résolu) : la forme qui marche aussi bien dans cordis que dans un
// contexte de test qui ne porte que `get` (même schéma que kybernos-slides).
// corps de requête lu à la main (pas de body parser sur ces routes —
// même lecture par événements que kybernos-slides).
const lireCorps = (req) => new Promise((res) => {
  let corps = ''
  req.on('data', (d) => { corps += d })
  req.on('end', () => { try { res(JSON.parse(corps || '{}')) } catch { res({}) } })
})

export function apply (ctx) {
  const poser = (c) => {
    try {
      const webServerSvc = c.get('webServer')
      if (webServerSvc === undefined) return
      webServerSvc.register({ kind: 'exact', path: '/kybernos-miniapps/install', handler: async (req, res) => {
        // M-03 : écrit + lance une app native — origine exacte et JSON requis.
        if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
        if (!jsonSeulement(req)) { res.writeHead(415); res.end('content-type application/json attendu'); return }
        const r = await installer(await lireCorps(req))
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(r))
      } })
      webServerSvc.register({ kind: 'exact', path: '/kybernos-miniapps/uninstall', handler: async (req, res) => {
        if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
        if (!jsonSeulement(req)) { res.writeHead(415); res.end('content-type application/json attendu'); return }
        const r = await desinstaller(await lireCorps(req))
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(r))
      } })
      webServerSvc.register({ kind: 'exact', path: '/kybernos-miniapps/list', handler: async (_req, res) => {
        const r = await lister()
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(r))
      } })
      dire('routes install / uninstall / list posées')
    } catch (e) {
      dire(`routes non posées : ${e?.message ?? e}`)
    }
  }
  if (ctx.get('webServer') !== undefined) poser(ctx)
  else ctx.inject(['webServer'], poser)
}
