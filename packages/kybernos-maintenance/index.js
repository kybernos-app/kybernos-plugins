// ═══════════════════════════════════════════════════════════════════════════
// kybernos-maintenance — host. Read-only.
//
// Route exposed (webServer, GET only):
//   GET /kybernos-maintenance/state
//
// Answers the lifecycle state — the SAME reads as `doctor`: versions (engine,
// plugin), pin alignment, missing links/bundles, applied patches,
// compatibility, update journal. The GUI invents nothing, it shows what the
// robot measures. Sentences that reach the client are French on purpose: the
// client translates them with its own tables (HS_STATIC / HS_RX).
// ═══════════════════════════════════════════════════════════════════════════

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditerSurfaces } from './surfaces.mjs'
import { lireVersion } from './version.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
// bundles live in <repo>/packages/<name>: the repo root is two levels up
const REPO = resolve(ICI, '..', '..')
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PROFIL_DIR = join(DSH_HOME, 'profiles', 'web')
const CYCLE_DIR = join(DSH_HOME, 'lifecycle')
const JOURNAL = join(CYCLE_DIR, 'journal.jsonl')
const PACKAGES = (() => { try { return JSON.parse(readFileSync(join(REPO, 'scripts', 'lifecycle-packages.json'), 'utf8')).packages } catch (e) { return [] } })()
const COMPAT_CHEMIN = join(REPO, 'dsh-compat.json')
// Written at the archive root by scripts/paquet.mjs, so it ships with the plugin.
const VERSION_CHEMIN = join(REPO, 'VERSION')

const run = (cmd, cwd) => new Promise((res) => {
  execFile(cmd[0], cmd.slice(1), { cwd, encoding: 'utf8', timeout: 60000 }, (err, stdout) =>
    res({ ok: !err, sortie: String(stdout || '') }))
})

// The same rule as the robot's gate (`scripts/lifecycle-engine.mjs`): an
// alphabetical comparison would make the Settings page say "inside the range"
// for a version the robot refuses (0.1.10 is later than 0.1.7, not the other
// way round). Duplicated on purpose: this plugin reads on its own, with no
// cross import.
export function comparerVersions (a, b) {
  const decouper = (v) => {
    const [noyau, ...reste] = String(v).split('-')
    return { nombres: noyau.split('.').map((x) => parseInt(x, 10) || 0), pre: reste.join('-') }
  }
  const x = decouper(a)
  const y = decouper(b)
  const n = Math.max(x.nombres.length, y.nombres.length)
  for (let i = 0; i < n; i += 1) {
    const dx = x.nombres[i] ?? 0
    const dy = y.nombres[i] ?? 0
    if (dx !== dy) return dx < dy ? -1 : 1
  }
  if (x.pre === y.pre) return 0
  if (x.pre === '') return 1
  if (y.pre === '') return -1
  const px = x.pre.split('.')
  const py = y.pre.split('.')
  const m = Math.max(px.length, py.length)
  for (let i = 0; i < m; i += 1) {
    if (px[i] === undefined) return -1
    if (py[i] === undefined) return 1
    const nx = /^\d+$/.test(px[i])
    const ny = /^\d+$/.test(py[i])
    if (nx && ny) { if (Number(px[i]) !== Number(py[i])) return Number(px[i]) < Number(py[i]) ? -1 : 1; continue }
    if (nx !== ny) return nx ? -1 : 1
    if (px[i] !== py[i]) return px[i] < py[i] ? -1 : 1
  }
  return 0
}

// ── published versions: the npm registry says what exists BEYOND the ────────
// installed one (request of 30/09: "the system should detect the latest
// harness versions and the compatibility"). Best effort with a 10 min cache:
// the Settings page must not run an `npm view` every time it opens.
let CACHE_REGISTRE = null
async function lireRegistre () {
  if (CACHE_REGISTRE !== null && Date.now() - CACHE_REGISTRE.quand < 600000) return CACHE_REGISTRE.valeur
  const r = await run(['npm', 'view', '@deepseek-ai/dsh', 'version', 'dist-tags', '--json'], REPO)
  let valeur
  try {
    const j = JSON.parse(r.sortie)
    const tags = j['dist-tags'] || j
    // The "latest version" reference = the newest across ALL CHANNELS
    // (latest, next, alpha) — the `latest` tag alone misses 0.2.0-rc.2
    // published under `next` (seen 30/09: the page said "up to date" wrongly).
    const paires = [['latest', tags.latest], ['next', tags.next], ['alpha', tags.alpha]].filter(([, v]) => Boolean(v))
    paires.sort((a, b) => comparerVersions(b[1], a[1]))
    valeur = {
      ok: r.ok && Boolean(tags.latest),
      latest: tags.latest || null,
      alpha: tags.alpha || null,
      next: tags.next || null,
      derniere: paires.length > 0 ? paires[0][1] : null,
      canal: paires.length > 0 ? paires[0][0] : null,
      erreur: null
    }
  } catch (e) {
    valeur = { ok: false, latest: null, alpha: null, next: null, derniere: null, canal: null, erreur: 'registre npm injoignable' }
  }
  CACHE_REGISTRE = { quand: Date.now(), valeur }
  return valeur
}

// ── update available? (04/10) ────────────────────────────────────────────────
// Two sources, a single answer for the GUI:
//   · the Kybernos PACK: installed `VERSION` against the `VERSION` published on
//     the public repo's main branch (no release is tagged, the branch is
//     authoritative) — cached for 1 h, never blocking;
//   · the DSH ENGINE: the same measure as the Maintenance page (`maj`).
// The client decides when to ask (at launch, then regularly) and how to
// notify; the host only measures, read-only.
const VERSION_DISTANTE = process.env.KYBERNOS_VERSION_URL || 'https://raw.githubusercontent.com/kybernos-app/kybernos-plugins/main/VERSION'
const DEPOT_URL = process.env.KYBERNOS_REPO_URL || 'https://github.com/kybernos-app/kybernos-plugins'
const FORME_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/
let CACHE_PACK = null
export async function lirePackDistant (force) {
  if (force !== true && CACHE_PACK !== null && Date.now() - CACHE_PACK.quand < 3600000) return CACHE_PACK.valeur
  let valeur
  const ctl = new AbortController()
  const minuteur = setTimeout(() => ctl.abort(), 6000)
  try {
    const res = await fetch(VERSION_DISTANTE, { signal: ctl.signal, headers: { 'cache-control': 'no-cache' } })
    const texte = String(await res.text()).trim()
    valeur = res.ok && FORME_VERSION.test(texte) ? { joignable: true, latest: texte } : { joignable: false, latest: null }
  } catch (e) { valeur = { joignable: false, latest: null } } finally { clearTimeout(minuteur) }
  CACHE_PACK = { quand: Date.now(), valeur }
  return valeur
}
function lireVersionPack () {
  try {
    const v = readFileSync(join(REPO, 'VERSION'), 'utf8').trim()
    return FORME_VERSION.test(v) ? v : null
  } catch (e) { return null }
}
/** Builds the response: pure, so testable without network or DSH. `pending` =
 *  what the GUI must announce (null = nothing to do): a new pack version
 *  first, otherwise a RECOMMENDED engine upgrade (never a version outside the
 *  supported range: the robot's gate would refuse it). */
export function composerMaj ({ pack, installee, etat, git, quand }) {
  const dispo = installee !== null && pack.latest !== null && comparerVersions(installee, pack.latest) < 0
  const maj = (etat && etat.maj) || { niveau: 'Inconnue', cible: null, note: '' }
  let pending = null
  if (dispo) pending = { kind: 'kybernos', cible: pack.latest, installee, requis: false, note: '' }
  else if (maj.cible && ['Requise', 'Recommandée', 'Possible'].indexOf(maj.niveau) >= 0) {
    pending = { kind: 'moteur', cible: maj.cible, installee: etat.global, requis: maj.niveau === 'Requise', note: maj.note || '' }
  }
  return {
    ok: true,
    checkedAt: quand,
    pack: { installee, latest: pack.latest, disponible: dispo, joignable: pack.joignable, depot: DEPOT_URL, git: git === true },
    moteur: { installee: etat ? etat.global : null, latest: etat && etat.distant ? etat.distant.derniere : null, niveau: maj.niveau, cible: maj.cible || null, note: maj.note || '' },
    pending
  }
}
/** `dep.etat` lets a test stand in for the engine measure (it runs `dsh` and asks npm); everything else is the real path. */
export async function mesurerMaj (force, dep = {}) {
  if (force === true) CACHE_REGISTRE = null
  const [pack, etat] = await Promise.all([lirePackDistant(force), (dep.etat ?? mesurerEtat)()])
  return composerMaj({ pack, installee: lireVersionPack(), etat, git: existsSync(join(REPO, '.git')), quand: new Date().toISOString() })
}

async function mesurerEtat () {
  const global = (await run(['dsh', '--version'])).sortie.trim().split('\n').pop() || 'inconnu'
  const plugin = (await run(['git', 'rev-parse', '--short', 'HEAD'], REPO)).sortie.trim() || 'inconnu'
  // The shipped semver (null when VERSION is missing or not a semver). `plugin`
  // stays the git hash: a tester who unpacked an archive has no checkout, so
  // there it reads 'inconnu' and the semver is what the page shows instead.
  const version = lireVersion(VERSION_CHEMIN)
  const compat = (() => { try { return JSON.parse(readFileSync(COMPAT_CHEMIN, 'utf8')) } catch (e) { return null } })()
  const distant = await lireRegistre()
  let pkg = null
  try { pkg = JSON.parse(readFileSync(join(PROFIL_DIR, 'package.json'), 'utf8')) } catch (e) { /* unreadable profile */ }
  const deps = pkg?.dependencies || {}
  const bundles = pkg?.dsh?.profile?.bundles || []
  const pins = Object.entries(deps).filter(([k]) => k.startsWith('@deepseek-ai/'))
  const pinsDivergents = pins.filter(([, v]) => v !== global).map(([k, v]) => `${k} ${v}`)
  const liensManquants = PACKAGES.map((p) => p.nom).filter((n) => !(deps[n] || '').startsWith('link:'))
  const bundlesManquants = PACKAGES.map((p) => p.nom).filter((n) => !bundles.includes(n))
  const horsZone = compat !== null && compat.dsh !== undefined && (
    (compat.dsh.min !== undefined && comparerVersions(global, compat.dsh.min) < 0) ||
    (compat.dsh.max !== undefined && comparerVersions(global, compat.dsh.max) > 0))
  const problemes = []
  if (pinsDivergents.length > 0) problemes.push(`Des paquets DSH du profil sont épinglés à une autre version que le moteur (${pinsDivergents.length}).`)
  for (const l of liensManquants) problemes.push(`Le paquet ${l} n'est pas lié au profil.`)
  for (const b of bundlesManquants) problemes.push(`Le bundle ${b} n'est pas déclaré.`)
  if (horsZone) problemes.push(`La version du moteur (${global}) n'a jamais été testée avec ce plugin.`)
  const journal = (() => {
    try {
      return readFileSync(JOURNAL, 'utf8').split('\n').filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l)).reverse().slice(0, 12)
    } catch (e) { return [] }
  })()
  // ── is the server serving the engine that is ON DISK? ───────────────────
  // On 22/09, a server started 4 h before the 0.1.7 upgrade kept serving the
  // old engine from memory: "Failed to load plugins — 1 entry did not
  // activate · …-jobs: waiting for service: jobs". We compare the age of the
  // current process (it knows it, no subprocess) with the last write of the
  // installation. Same rule as the robot's gate.
  const mtime = (chemin) => { try { return statSync(chemin).mtimeMs } catch (e) { return null } }
  const demarrageServeur = Date.now() - Math.round(process.uptime() * 1000)
  // `npm root -g` says where the installed engine is: that is the package
  // `npm i -g` rewrites on a version upgrade.
  const racineGlobale = (await run(['npm', 'root', '-g'], REPO)).sortie.trim()
  const dates = [
    racineGlobale === '' ? null : mtime(join(racineGlobale, '@deepseek-ai', 'dsh', 'package.json')),
    mtime(join(PROFIL_DIR, 'node_modules', '.modules.yaml')),
    mtime(join(PROFIL_DIR, 'pnpm-lock.yaml'))
  ].filter((d) => d !== null)
  const installation = dates.length === 0 ? null : Math.max(...dates)
  const serveurPerime = installation !== null && installation - demarrageServeur > 10000
  if (serveurPerime) {
    problemes.push('Le serveur a démarré avant la dernière mise à jour : il sert encore l\'ancien moteur. Redémarre DSH.')
  }
  // ── the engine SURFACES: what the installed version breaks or takes over ──
  // Same lesson as the 0.1.6 → 0.1.7 upgrade: "applied" patches do not say
  // their anchors still exist. We audit the contracts our patches and plugins
  // read, and flag native capabilities that overlap one of our features. A
  // failing audit does not take the page down: the error is returned apart.
  let surfaces = null
  try {
    const a = auditerSurfaces(racineGlobale)
    surfaces = {
      conformes: a.sondes.filter((s) => s.ok).length,
      total: a.sondes.length,
      mesureesSurVierge: a.sondes.filter((s) => s.sur === 'vierge').length,
      ruptures: a.ruptures,
      aVerifier: a.aVerifier,
      doublons: a.doublons,
      natifs: a.natifs
    }
    for (const r of a.ruptures) problemes.push(r)
  } catch (e) {
    surfaces = { erreur: String(e && e.message ? e.message : e), ruptures: [], aVerifier: [], doublons: [], natifs: [] }
  }
  // ── compatibility LEVEL of the plugin with the INSTALLED engine ──────────
  // The contract (dsh-compat.json) declares the supported range (min/max) and
  // the TESTED versions. Same reading rule as the robot's gate:
  //   Parfaite    = engine = the highest tested version;
  //   Compatible  = inside the range, NEWER than the tested one (untested);
  //   Partielle   = inside the range, OLDER than the tested one (fewer
  //                 patches — the validated 0.1.7-alpha.1 scenario);
  //   Hors zone   = below min or above max: must not run.
  const testee = compat !== null && Array.isArray(compat.dsh?.testees) && compat.dsh.testees.length > 0
    ? [...compat.dsh.testees].sort((a, b) => comparerVersions(a, b)).pop()
    : null
  let niveau = 'Inconnue'
  if (compat === null || compat.dsh === undefined) niveau = 'Inconnue'
  else if (horsZone) niveau = 'Hors zone'
  else if (testee !== null && comparerVersions(global, testee) === 0) niveau = 'Parfaite'
  else if (testee !== null && comparerVersions(global, testee) > 0) niveau = 'Compatible'
  else niveau = 'Partielle'
  // Compatibility range of any version (to talk about channels).
  const horsZoneV = (v) => compat !== null && compat.dsh !== undefined && (
    (compat.dsh.min !== undefined && comparerVersions(v, compat.dsh.min) < 0) ||
    (compat.dsh.max !== undefined && comparerVersions(v, compat.dsh.max) > 0))
  // Direction of the installed engine vs the NEWEST published across all
  // channels: up = the installed one is newer (local checkout), down = a newer
  // one exists (even under `next`), same = aligned.
  const direction = !distant.ok || distant.derniere === null || global === 'inconnu'
    ? 'same'
    : (comparerVersions(global, distant.derniere) > 0 ? 'up' : comparerVersions(global, distant.derniere) < 0 ? 'down' : 'same')
  // Note of the Engine card: what the registry says, channel included.
  distant.note = (() => {
    if (!distant.ok || distant.derniere === null) return null
    const c = comparerVersions(global, distant.derniere)
    if (c === 0) return distant.canal === 'latest'
      ? `à jour — dernière publiée : ${distant.derniere}`
      : `à jour de la plus récente publiée (${distant.canal} ${distant.derniere})`
    if (c < 0) return `plus récente publiée : ${distant.derniere} (canal ${distant.canal} — ${horsZoneV(distant.derniere) ? 'hors zone supportée' : 'dans la zone'})`
    return `en avance sur la plus récente publiée (${distant.derniere})`
  })()
  // Advised UPDATE level, target and note — computed host side.
  const maj = (() => {
    if (compat !== null && compat.dsh?.min !== undefined && comparerVersions(global, compat.dsh.min) < 0) {
      return { niveau: 'Requise', cible: testee, note: `Minimum demandé par le plugin : ${compat.dsh.min}.` }
    }
    if (horsZone) return { niveau: 'Recommandée', cible: testee, note: 'Moteur hors de la zone supportée — reviens à la version testée ou attends un plugin adapté.' }
    if (!distant.ok || distant.derniere === null) return { niveau: 'Inconnue', cible: null, note: 'Registre npm injoignable — impossible de savoir si une mise à jour existe.' }
    const c = comparerVersions(global, distant.derniere)
    if (c < 0) {
      // A newer version exists: advise it ONLY if it is inside the supported
      // range — otherwise the robot's gate refuses it.
      if (horsZoneV(distant.derniere)) {
        return { niveau: 'Aucune', cible: null, note: `Une version plus récente existe (${distant.derniere}, canal ${distant.canal}) mais elle est hors de la zone supportée — attendre un plugin adapté.` }
      }
      if (niveau === 'Partielle') return { niveau: 'Recommandée', cible: distant.derniere, note: 'Une version plus récente du moteur réactiverait les retouches non posées.' }
      if (niveau === 'Compatible') return { niveau: 'Possible', cible: distant.derniere, note: 'Version publiée prête ; dans la zone supportée, rien ne presse.' }
      return { niveau: 'Possible', cible: distant.derniere, note: 'Version publiée dans la zone supportée, même contrat.' }
    }
    if (c > 0) return { niveau: 'Aucune', cible: null, note: 'Moteur plus récent que la plus récente version publiée (installation locale).' }
    if (niveau === 'Compatible') return { niveau: 'Possible', cible: testee, note: 'Moteur plus récent que la version testée — la prochaine campagne de tests la validera.' }
    return { niveau: 'Aucune', cible: null, note: 'Moteur installé = plus récente version publiée, tous canaux.' }
  })()
  // ── compatibility MATRIX: the known markers (tested, installed, registry ──
  // releases), sorted newest first, with a level per row.
  const reperes = []
  const pousser = (v, niv, detail, repere) => {
    const deja = reperes.find((r) => r.v === v)
    if (deja !== undefined) { if (deja.repere.indexOf(repere) === -1) deja.repere += ' · ' + repere; return }
    if (v && v !== 'inconnu') reperes.push({ v, niveau: niv, detail, repere })
  }
  for (const v of (compat?.dsh?.testees || [])) pousser(v, 'Parfaite', 'Testée ensemble, retouches posées.', 'testée')
  pousser(global, null, '', 'installée')
  pousser(distant.latest, null, '', 'npm latest')
  pousser(distant.alpha, null, '', 'npm alpha')
  pousser(distant.next, null, '', 'npm next')
  for (const r of reperes) {
    if (r.niveau !== null) continue
    if (compat === null || compat.dsh === undefined) { r.niveau = 'Inconnue'; r.detail = 'Zone de compatibilité absente du dépôt.'; continue }
    const infMin = compat.dsh.min !== undefined && comparerVersions(r.v, compat.dsh.min) < 0
    const supMax = compat.dsh.max !== undefined && comparerVersions(r.v, compat.dsh.max) > 0
    if (infMin || supMax) { r.niveau = 'Hors zone'; r.detail = infMin ? 'Plus ancien que le minimum supporté.' : 'Plus récent que le maximum supporté — ne doit pas tourner.' }
    else if (testee !== null && comparerVersions(r.v, testee) > 0) { r.niveau = 'Compatible'; r.detail = 'Dans la zone, pas encore testée avec ce plugin.' }
    else { r.niveau = 'Partielle'; r.detail = 'Démarrerait, des retouches en moins.' }
  }
  reperes.sort((a, b) => comparerVersions(b.v, a.v))
  return {
    global, plugin, version, problemes, surfaces,
    couleur: problemes.length === 0 ? 'verte' : 'orange',
    compat: compat !== null ? { min: compat.dsh?.min ?? null, max: compat.dsh?.max ?? null, horsZone: Boolean(horsZone) } : null,
    testee,
    niveau,
    direction,
    maj,
    distant,
    versions: reperes.slice(0, 7).map((r) => ({ ...r, ici: r.v === global })),
    serveur: { perime: serveurPerime, demarrageServeur, installation },
    journal
  }
}

const envoyer = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

const origineOK = (req) => {
  // 2026-10 review (M-02/S-03): EXACT host of the socket's real listening
  // address, never a prefix ("localhost.evil.example" used to pass).
  const o = String(req.headers.origin || '')
  if (o === '') return true
  try {
    const u = new URL(o)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const port = (req.socket && typeof req.socket.localPort === 'number') ? ':' + req.socket.localPort : ''
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0
  } catch { return false }
}

export function apply (ctx) {
  const demarrer = (hostCtx) => {
    hostCtx.webServer.register({ kind: 'exact', path: '/kybernos-maintenance/state', handler: async (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
      if (!origineOK(req)) { res.writeHead(403); res.end(); return }
      try { envoyer(res, 200, await mesurerEtat()) }
      catch (e) { envoyer(res, 500, { erreur: String(e && e.message ? e.message : e) }) }
    } })
    hostCtx.webServer.register({ kind: 'exact', path: '/kybernos-maintenance/update', handler: async (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
      if (!origineOK(req)) { res.writeHead(403); res.end(); return }
      try {
        const force = String(req.url || '').indexOf('force=1') >= 0
        envoyer(res, 200, await mesurerMaj(force))
      } catch (e) { envoyer(res, 500, { ok: false, erreur: String(e && e.message ? e.message : e) }) }
    } })
    console.log('[kybernos-maintenance] webServer routes /kybernos-maintenance/state and /update registered (read-only)')
  }
  if (ctx.get('webServer') !== undefined) demarrer(ctx)
  else ctx.inject(['webServer'], demarrer)
}
