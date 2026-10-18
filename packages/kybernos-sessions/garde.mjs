#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// garde — the isolation « agent hook ».
//
//   node kybernos-sessions/garde.mjs [--nom <slug>] [--but "<sentence>"] [--isoler]
//
// To be called BEFORE THE FIRST FILE WRITE of a piece of work (rule in
// ~/.dsh/AGENTS.md). Decision, then action:
//   • the folder is already a worktree        → exit 0: already isolated, work here;
//   • outside git, not shared                 → exit 0: nothing to isolate;
//   • outside git, SHARED                     → exit 0: no tree possible,
//                                               but WARNS (see « order » below);
//   • folder not shared                       → exit 0: work in place;
//   • shared + a free tree of the same name   → exit 2: REUSE it, nothing created;
//   • shared, no tree, no --isoler            → exit 0: work in place;
//   • shared + --isoler                       → exit 2: tree created (or reused).
//
// CLAIMING A HOT FILE — the collision point the folder guard cannot SEE (it
// measures how much a folder is shared over 1 h, not « this file is being
// written right now »):
//   node kybernos-sessions/garde.mjs --claim client.js    → exit 0: claimed 180 s
//                                                         → exit 4: already taken elsewhere
//   node kybernos-sessions/garde.mjs --release client.js  → exit 0: released
// Without this claim, « one writer per hot file » stayed a wish.
//
// PUBLICATION WATCH — the second stage, for the INTERMEDIATE revision:
//   node kybernos-sessions/garde.mjs --veille [--interval 1000] [--une-fois]
//
// The client code of a local bundle is served HOT from the disk: every revision
// that goes through the file is seen by the open pages. A write in several
// passes (or two writers, or an interrupted write) therefore publishes a
// revision THAT DOES NOT PARSE, and the whole entry fails at boot —
// « Failed to load plugins @local/kybernos ». Seen on 23/09/2026.
//
// The watch keeps a copy of the last GREEN revision of every hot file
// (~/.dsh/kybernos/last-good/) and, as soon as a revision no longer parses,
// puts the green one back within the second. It does not judge intent: it
// protects the SERVED GUI. The log (~/.dsh/kybernos/veille-bundle.log) says which
// revision was replaced; the writer must re-read its file (the file system's
// version guard forces it to anyway).
//
// The « parses » verdict is given by `--input-type=module`, NOT by
// `node --check <file>.js`: measured on 23/09/2026 on Node 26.7.0, the latter
// returns 0 (`= {{{`, `= = 1`) on a broken client bundle. `--check` (without
// the watch) goes through the same gate on demand, so as not to deliver an
// unreadable revision.
//
// WHY « in place » by default: a worktree cannot be attached to the CURRENT
// chat — the session and the GUI serve the main checkout
// (`<checkout>/plugins/…`). Creating a tree at every write produced dead trees:
// two seen on 21/09/2026, clean, at 0 commits ahead, and a third already
// reported « left, redundant » the day before. A tree only makes sense for a
// NEXT chat opened inside it: so it is reserved explicitly (--isoler), and it
// is marked, reused and reclaimable (`reclaim`).
//
// Quick talks (no write) never call the guard.
// ═══════════════════════════════════════════════════════════════════════════

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { etatGit, isoler, repartitionParDossier, slugsDeChemin, sondeIsolation } from './index.js'

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut
}
const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const chemin = process.cwd()
const sessionsHome = join(home, 'sessions')
// The name must be STABLE for the same chat, otherwise the reuse cannot
// recognise the tree reserved on the previous turn and makes a second one.
// Without `DSH_SESSION_ID` (a non-DSH session), two chats cannot be told apart:
// the name is derived from the FOLDER rather than falling back on a global
// constant — the old `s-chantier` made every session collide on the same tree.
const sessionCourte = String(process.env.DSH_SESSION_ID || '').replace(/[^a-z0-9]/gi, '').slice(0, 8)
const dossierCourt = createHash('sha1').update(process.cwd()).digest('hex').slice(0, 8)
const nom = arg('--nom') || ('s-' + (sessionCourte || 'd' + dossierCourt))
const but = arg('--but')
const demande = process.argv.includes('--isoler') || process.env.KYBERNOS_ISOLATE === '1'

// pure decision (exportable/testable): is this folder shared within the hour?
//
// The slug of the store is DECODED from the real names, never built by hand: DSH
// encodes special characters (`~0020` for a space), and a naive slug answered
// « not shared » — hence « work in place » — on a folder that was really busy.
export function decider (cheminCourant, sessionsHome, fenetreMs = 3600 * 1000, horloge = Date.now) {
  const r = repartitionParDossier(sessionsHome, fenetreMs, horloge())
  const slugs = slugsDeChemin(sessionsHome, cheminCourant)
  const sessionsActives = slugs.reduce((n, s) => n + (r[s] || { sessionsActives: 0 }).sessionsActives, 0)
  return { slug: slugs[0] || null, slugs, partage: sessionsActives >= 2, sessionsActives }
}

// ── Hot files: a claim per FILE, not per folder ──────────────────────────────
// `decider` above measures how much a folder is SHARED over 1 h: it cannot say
// « client.js is being written right now ». Yet that is THE collision seen on
// 22-23/09/2026 (three sessions on a single checkout, collision point
// kybernos-plugin/client.js, 1 MB / ~13,000 lines). Without a claim per file,
// « one writer per hot file » stayed a wish.
// All the client bundles of the repository are served hot from the disk: a net
// that covered only `kybernos-plugin` would leave ten bundles breakable without
// the watch. Measured on 23/09/2026: the health banner lives in
// `kybernos-sessions/client.js`, so in a hot file too.
export const FICHIERS_CHAUDS = [
  'packages/kybernos-plugin/client.js',
  'packages/kybernos-plugin/index.js',
  'packages/kybernos-sessions/client.js',
  'packages/kybernos-models/client.js',
  'packages/kybernos-theme/client.js',
  'packages/kybernos-slash/client.js',
  'packages/kybernos-skills/client.js',
  'packages/kybernos-composio/client.js',
  'packages/kybernos-cloud/client.js',
  'packages/kybernos-maintenance/client.js',
  'packages/kybernos-relance/client.js',
  'packages/kybernos-flow/client.js',
  // Added on 24/09/2026: the « Bricks » panel lives in a client bundle served
  // hot, like the others. It was missing from this list — the guard answered
  // « not a known hot file », so nobody claimed it.
  'packages/kybernos-bricks/client.js',
  // Recette 03/10: client bundles that appeared since — the worktree suite (C1b)
  // claimed them, the guard ignored them (« not a known hot file »).
  'packages/kybernos-auto/client.js',
  'packages/kybernos-computers/client.js',
  'packages/kybernos-language/client.js',
  'packages/kybernos-miniapps/client.js',
  'packages/kybernos-modeles-locaux/client.js',
  'packages/kybernos-modeleur/client.js',
  'packages/kybernos-refs/client.js',
  'packages/kybernos-search/client.js',
  'packages/kybernos-servers/client.js',
  'packages/kybernos-mobile/client.js',
  'packages/kybernos-terminal/client/client.js',
  'packages/kybernos-slides/client.js',
  'packages/kybernos-motion/client.js',
  'packages/kybernos-changes/client.js',
  'packages/kybernos-call/client.js',
  'packages/kybernos-websearch/client.js',
  'packages/kybernos-usage/client.js',
  'packages/kybernos-multi-device/client.js',
  'packages/kybernos-dashboards/client.js',
  'packages/kybernos-summary/client.js',
  'packages/kybernos-kyber/client.js',
]
export const TTL_CLAIM_MS = 180 * 1000

// Pure: the claims that are still alive. An expired claim is ignored — a chat
// killed without releasing must not block the next one forever (the same choice
// as `dsh-relance-claims.json`, 180 s).
export function claimsVivants (claims, maintenant = Date.now()) {
  const c = claims && typeof claims === 'object' ? claims : {}
  const out = {}
  for (const f of Object.keys(c)) {
    const v = c[f]
    if (v && typeof v.expire === 'number' && v.expire > maintenant) out[f] = v
  }
  return out
}

// Pure: the holder of a hot file when it is NOT us (null otherwise).
export function claimConcurrent (claims, fichier, session, maintenant = Date.now()) {
  const v = claimsVivants(claims, maintenant)[fichier]
  if (!v) return null
  return String(v.session || '') === String(session || '') ? null : v
}

// ── Verdict of a watch pass (pure, so testable without a disk) ───────────────
// What to do with a revision: PUBLISH it (it parses), REPLACE it with the last
// known green one (it no longer parses and a safety copy exists), or only FLAG it
// (it no longer parses and there is no safety copy: a valid version cannot be
// invented).
export function verdictRevision ({ parseOk, filetOk }) {
  if (parseOk === true) return 'publier'
  return filetOk === true ? 'remplacer' : 'signaler'
}

const SNAPSHOTS = () => join(home, 'kybernos', 'last-good')
const JOURNAL = () => join(home, 'kybernos', 'veille-bundle.log')
// The name keeps the readable characters (`-`, `.`, `_`) and only replaces what
// separates: the safety copy of `kybernos-plugin/client.js` is called
// `kybernos-plugin__client.js`, so readable in an `ls last-good`.
const nomSnapshot = (rel) => rel.replace(/[^a-zA-Z0-9._-]+/g, '__')
// `node --check <file>.js` is NOT ENOUGH for these bundles — measured on
// 23/09/2026 on Node 26.7.0: it returns 0 on `export const vert = {{{` and on
// `export const a = = 1` (the CommonJS pass swallows the error), while the same
// content as `.mjs` returns 1. A client bundle is a MODULE: so we validate by
// forcing module mode through standard input (no temporary file, and the
// verdict does not depend on the extension).
const parsee = (f) => {
  try {
    const r = spawnSync(process.execPath, ['--input-type=module', '--check', '-'], {
      input: readFileSync(f), stdio: ['pipe', 'ignore', 'ignore'],
    })
    return r.status === 0
  } catch (e) { return false }
}
const journaliser = (ligne) => {
  try {
    mkdirSync(dirname(JOURNAL()), { recursive: true })
    appendFileSync(JOURNAL(), new Date().toISOString() + '  ' + ligne + '\n')
  } catch (e) { /* log unavailable: the watch goes on */ }
}

// Content signature: it is THIS that avoids re-validating 1 MB per second.
// A bare `mtime` would be fooled by a write of the same size in the same
// millisecond; the hash reads the file (1.4 MB/s, negligible) but no longer
// starts a node process nor copies the safety copy again as long as nothing changed.
const signature = (f) => createHash('sha1').update(readFileSync(f)).digest('hex').slice(0, 16)

/**
 * One watch pass over the hot files of a folder. Does not block, does not
 * throw: a watch must never make a piece of work fail.
 * @param {Map<string,string>} memo signatures already judged (avoids idle work)
 * @returns {{ publies: string[], remplaces: string[], signales: string[] }}
 */
export function passeVeille (dossier, fichiers = FICHIERS_CHAUDS, memo = new Map()) {
  const out = { publies: [], remplaces: [], signales: [] }
  const snap = SNAPSHOTS()
  try { mkdirSync(snap, { recursive: true }) } catch (e) { /* no safety copy possible */ }
  for (const rel of fichiers) {
    const cible = join(dossier, rel)
    let sig = null
    try { sig = signature(cible) } catch (e) { continue }
    // Nothing moved since the last judged pass: neither the validation (a node
    // process and 1 MB to parse) nor the copy of the safety copy is redone.
    if (memo.get(rel) === sig) continue
    const filet = join(snap, nomSnapshot(rel))
    const filetOk = existsSync(filet) === true && parsee(filet) === true
    const verdict = verdictRevision({ parseOk: parsee(cible), filetOk })
    if (verdict === 'publier') {
      try { copyFileSync(cible, filet); memo.set(rel, sig) } catch (e) { /* safety copy not written */ }
      out.publies.push(rel)
      continue
    }
    if (verdict === 'remplacer') {
      try {
        copyFileSync(filet, cible)
        memo.delete(rel) // putting it back changes the content: it will be judged again
        out.remplaces.push(rel)
        journaliser('REPLACED ' + rel + ' — unreadable revision, last green one put back')
      } catch (e) { out.signales.push(rel) }
      continue
    }
    memo.set(rel, sig) // a single log line per unreadable revision
    out.signales.push(rel)
    journaliser('FLAGGED ' + rel + ' — unreadable revision and NO green safety copy known')
  }
  return out
}

/**
 * The watch loop. `--une-fois` is for the tests (one pass, then control is handed back).
 */
export function veille (options = {}) {
  const dossier = options.dossier || chemin
  const interval = Number(options.interval || 1000)
  const uneFois = options.uneFois === true
  const fichiers = options.fichiers || FICHIERS_CHAUDS
  const memo = new Map()
  let arret = false
  const passe = () => {
    const r = passeVeille(dossier, fichiers, memo)
    if (options.verbeux === true && (r.publies.length > 0 || r.remplaces.length > 0)) {
      console.log('  ' + new Date().toISOString() + '  green=' + r.publies.length
        + ' replaced=' + r.remplaces.length + ' without safety copy=' + r.signales.length)
    }
    return r
  }
  passe()
  if (uneFois === true) return
  console.log('publication watch: ' + fichiers.join(', ') + ' (every ' + interval + ' ms)')
  console.log('  safety copies: ' + SNAPSHOTS())
  console.log('  log: ' + JOURNAL())
  const timer = setInterval(passe, interval)
  const finir = () => { arret = true; clearInterval(timer); process.exit(0) }
  process.on('SIGINT', finir)
  process.on('SIGTERM', finir)
  void arret
}

// ── PERMANENT watch (LaunchAgent, to outlive the closing of the chats) ───────
// Measured: the watch as a background job dies with the session — so exactly when
// nobody watches any more. The LaunchAgent, for its part, starts at login and
// restarts by itself (`KeepAlive`), like `com.kybernos.dsh-relance`.
export const LABEL_VEILLE = 'com.kybernos.dsh-veille-bundle'
const cheminPlist = () => join(homedir(), 'Library', 'LaunchAgents', LABEL_VEILLE + '.plist')
const uid = String(process.getuid === undefined ? '' : process.getuid())

/**
 * Plist of the watch. The bundle path is FROZEN (like the other Kybernos agents):
 * a moved repository needs a reinstall, which `--install` redoes.
 */
export function plistVeille (racine, intervalle = 1000, noeud = process.execPath, journal = join(home, 'logs')) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL_VEILLE}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${noeud}</string>
    <string>${join(racine, 'packages', 'kybernos-sessions', 'garde.mjs')}</string>
    <string>--veille</string>
    <string>--interval</string>
    <string>${String(intervalle)}</string>
    <string>--dossier</string>
    <string>${racine}</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>DSH_HOME</key>
    <string>${home}</string>
  </dict>

  <key>StandardOutPath</key>
  <string>${join(journal, 'veille-bundle.out.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(journal, 'veille-bundle.err.log')}</string>

  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`
}

/** Installs (or removes) the permanent watch. Returns a report, does not throw. */
export function agentVeille (action, racine = chemin, intervalle = 1000) {
  const p = cheminPlist()
  const launchctl = (args) => spawnSync('launchctl', args, { encoding: 'utf8' })
  if (action === 'install') {
    try {
      mkdirSync(dirname(p), { recursive: true })
      mkdirSync(join(home, 'logs'), { recursive: true })
      writeFileSync(p, plistVeille(racine, intervalle))
    } catch (e) { return { ok: false, quoi: 'writing the plist', erreur: e.message } }
    launchctl(['bootout', 'gui/' + uid, p])
    const r = launchctl(['bootstrap', 'gui/' + uid, p])
    if (r.status !== 0) return { ok: false, quoi: 'launchctl bootstrap', erreur: (r.stderr || '').trim() || ('code ' + String(r.status)) }
    return { ok: true, quoi: 'permanent watch installed', plist: p }
  }
  if (action === 'uninstall') {
    launchctl(['bootout', 'gui/' + uid, p])
    if (existsSync(p)) {
      try { rmSync(p) } catch (e) { return { ok: false, quoi: 'removing the plist', erreur: e.message } }
    }
    return { ok: true, quoi: 'permanent watch removed', plist: p }
  }
  // 'etat': what launchd says about it, and what the watch did.
  const r = launchctl(['print', 'gui/' + uid + '/' + LABEL_VEILLE])
  const vivante = r.status === 0
  let dernier = []
  try {
    dernier = readFileSync(JOURNAL(), 'utf8').trim().split('\n').slice(-5)
  } catch (e) { dernier = [] }
  return { ok: true, quoi: vivante ? 'permanent watch loaded' : 'permanent watch ABSENT', plist: p, journal: dernier }
}

const moiSession = process.env.DSH_SESSION_ID || ('pid-' + process.pid)
const CLAIMS = join(home, 'kybernos', 'hot-claims.json')

const lireClaims = () => {
  try {
    const j = JSON.parse(readFileSync(CLAIMS, 'utf8'))
    return j && typeof j === 'object' ? j : {}
  } catch (e) { return {} }
}

// Best effort by design: a claim must NEVER make a piece of work fail.
const ecrireClaims = (c) => {
  try {
    mkdirSync(dirname(CLAIMS), { recursive: true })
    writeFileSync(CLAIMS, JSON.stringify(claimsVivants(c), null, 2) + '\n')
  } catch (e) { /* disk full, permissions…: we go on without a claim */ }
}

// Accepts the full path or the bare name (« client.js »): at the keyboard one
// types the name, and an exact path would be a friction that makes people give
// the rule up. But several bundles now carry a `client.js`: `--claim client.js`
// can no longer mean « the first that matches » — it must refuse and name the
// candidates (a claim put on the wrong bundle protects nothing).
export const resoudreChaud = (saisie) => {
  if (!saisie) return { ambigu: [] }
  const s = String(saisie).replace(/^\.\//u, '')
  const exact = FICHIERS_CHAUDS.filter((f) => f === s)
  if (exact.length === 1) return { fichier: exact[0] }
  const parNom = FICHIERS_CHAUDS.filter((f) => f.endsWith('/' + s))
  if (parNom.length === 1) return { fichier: parNom[0] }
  return { ambigu: parNom }
}

// only runs when invoked directly (the import for the tests does nothing)
const direct = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())

const main = async () => {
  // ── Publication gate (--check) ────────────────────────────────────────────
  // To be passed BEFORE announcing that a change to the bundle is ready: it is
  // the same verdict as the watch, but on demand. Exits 1 if a hot file does not
  // parse (the watch would replace it).
  if (process.argv.includes('--check')) {
    const dossierCheck = arg('--dossier', chemin)
    let casses = 0
    for (const rel of FICHIERS_CHAUDS) {
      const f = join(dossierCheck, rel)
      if (existsSync(f) !== true) { console.log('· absent: ' + rel); continue }
      const bon = parsee(f)
      if (bon === false) casses += 1
      console.log((bon ? '✓ ' : '✗ ') + rel + (bon ? ' parses (module)' : ' DOES NOT PARSE — do not deliver as it is'))
    }
    process.exit(casses === 0 ? 0 : 1)
  }

  // ── Publication watch (--veille) ──────────────────────────────────────────
  // Before everything else: it loops, it takes no decision about the work.
  if (process.argv.includes('--veille')) {
    const dossierVeille = arg('--dossier', chemin)
    const intervalle = arg('--interval', '1000')
    // Life cycle of the PERMANENT watch (it outlives the chats).
    const cycle = ['--install', '--uninstall', '--etat'].find((f) => process.argv.includes(f))
    if (cycle !== undefined) {
      const r = agentVeille(cycle.slice(2), dossierVeille, Number(intervalle))
      if (r.ok !== true) {
        console.log('✗ ' + r.quoi + ': ' + String(r.erreur || 'failed'))
        process.exit(1)
      }
      console.log('✓ ' + r.quoi)
      console.log('  plist: ' + r.plist)
      if (r.journal !== undefined) {
        console.log('  log: ' + (r.journal.length === 0 ? '(no line — nothing to repair)' : ''))
        for (const l of r.journal) console.log('    ' + l)
      }
      process.exit(0)
    }
    veille({
      dossier: dossierVeille,
      interval: intervalle,
      uneFois: process.argv.includes('--une-fois'),
      verbeux: process.argv.includes('--verbeux'),
    })
    return
  }

  // ── Claiming a hot file (--claim / --release) ──────────────────────────────
  const demandeClaim = arg('--claim')
  const demandeRelease = arg('--release')
  if (demandeClaim || demandeRelease) {
    const demande = demandeClaim || demandeRelease
    const cible = resoudreChaud(demande)
    if (cible.fichier === undefined) {
      if (cible.ambigu.length > 1) {
        console.log('✗ « ' + demande + ' » designates ' + cible.ambigu.length + ' hot files — name the bundle:')
        for (const c of cible.ambigu) console.log('  · ' + c)
      } else {
        console.log('✗ « ' + demande + ' » is not a known hot file.')
        console.log('  known: ' + FICHIERS_CHAUDS.join(', '))
      }
      process.exit(3)
    }
    const f = cible.fichier
    const claims = lireClaims()
    if (demandeRelease) {
      const v = claims[f]
      if (v && String(v.session || '') === moiSession) delete claims[f]
      ecrireClaims(claims)
      console.log('✓ claim released: ' + f)
      process.exit(0)
    }
    const conc = claimConcurrent(claims, f, moiSession)
    if (conc !== null) {
      const restant = Math.max(0, Math.round(((conc.expire || 0) - Date.now()) / 1000))
      console.log('⚠ ' + f + ' is ALREADY claimed by another chat: ' + (conc.session || '?') + ' (' + restant + ' s left)')
      console.log('  One writer per hot file: do not write in it now.')
      console.log('  Wait for the release, or ask that chat to give it up:')
      console.log('  node kybernos-sessions/garde.mjs --release ' + f)
      process.exit(4)
    }
    claims[f] = { session: moiSession, debut: Date.now(), expire: Date.now() + TTL_CLAIM_MS }
    ecrireClaims(claims)
    console.log('✓ claimed for ' + (TTL_CLAIM_MS / 1000) + ' s: ' + f)
    console.log('  Renew with --claim before it expires if the write goes on.')
    process.exit(0)
  }

  // The REAL collision point, said BEFORE the isolation decision: the folder
  // guard does not see it.
  const vivants = claimsVivants(lireClaims())
  const conflits = FICHIERS_CHAUDS.filter((f) => claimConcurrent(vivants, f, moiSession) !== null)
  if (conflits.length > 0) {
    for (const f of conflits) {
      const v = claimConcurrent(vivants, f, moiSession)
      const restant = Math.max(0, Math.round(((v.expire || 0) - Date.now()) / 1000))
      console.log('⚠ hot file ALREADY claimed: ' + f + ' — ' + (v.session || '?') + ' (' + restant + ' s)')
    }
    console.log('  Do not write in it: wait, or take another scope.')
  } else if (Object.keys(vivants).length > 0) {
    console.log('✓ hot file(s) claimed by you: ' + Object.keys(vivants).join(', '))
  }

  const g = await etatGit(chemin)

  // SHARING is tested BEFORE the git finding. Outside git no isolation exists:
  // the warning is then the ONLY protection, and the old order (`!g.git` first)
  // skipped it exactly in that case — it answered « nothing to isolate, work in
  // place », the most reassuring message of the lot, to a folder that 13 sessions
  // shared. Seen on 22/09/2026: /Users/me/projects/testing, 72 sessions,
  // 13 active within the hour, one of them writing while we were writing.
  const d = decider(chemin, sessionsHome)

  if (!g.git) {
    if (d.partage) {
      console.log('⚠ outside git AND folder SHARED — no isolation possible here')
      console.log('  ' + d.sessionsActives + ' active session(s) within the hour on this folder.')
      console.log('  No tree is possible (no repository): write ONLY in a subfolder of your')
      console.log('  own, and do not touch the files at the root.')
    } else {
      console.log('✓ outside git — nothing to isolate, work in place')
    }
    process.exit(0)
  }
  if (g.worktree) { console.log('✓ already isolated (worktree) — work here'); process.exit(0) }
  if (!d.partage) { console.log('✓ folder not shared — work in place'); process.exit(0) }

  const s = await sondeIsolation({ chemin, nom, sessionsHome })
  if (s.dejaIsole) { console.log('✓ already isolated — work here'); process.exit(0) }

  if (s.reutilisable) {
    console.log('⚠ shared folder — a FREE isolation tree already exists, reused:')
    console.log('  ' + s.cible)
    console.log('  branch: ' + s.branche)
    console.log('  → open the NEXT chat in this folder; do not create a second one.')
    process.exit(2)
  }

  if (!demande) {
    console.log('✓ shared folder — a worktree cannot be attached to THIS chat')
    console.log('  (the session and the GUI serve the main checkout: the edits made')
    console.log('  in a tree would not show up). Work in place.')
    console.log('  To reserve a tree for the NEXT chat:')
    console.log('  node kybernos-sessions/garde.mjs --isoler [--nom <slug>] [--but "<sentence>"]')
    process.exit(0)
  }

  if (!s.ok) {
    console.log('✗ isolation requested but impossible: ' + s.erreur)
    if (s.cible) console.log('  target: ' + s.cible)
    console.log('  → commit (or clean the tree) then run again.')
    process.exit(3)
  }

  const r = await isoler({ chemin, nom, but, exec: true, sessionsHome })
  if (r.ok !== true) { console.log('✗ isolation refused: ' + r.erreur); process.exit(3) }
  console.log('⚠ shared folder — worktree ' + (r.reutilise ? 'reused' : 'created') + ':')
  console.log('  ' + r.cible)
  console.log('  branch: ' + r.branche)
  console.log('  → open the NEXT chat in this folder so that it is isolated there.')
  process.exit(2)
}

if (direct) main()
