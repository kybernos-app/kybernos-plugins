// ═══════════════════════════════════════════════════════════════════════════
// kybernos-sessions — host.
//
// Two real reads of the state of the work, and the actions around it:
//   • the « sessions » state of a folder: how many sessions wrote there recently
//     (sliding window), git (branch, dirty, pushed);
//   • the « memory » state of the agent teams: lessons, ledger runs, members.
//
// Routes (webServer):
//   GET  /kybernos-sessions/state?session=<id>[&kyber=<id>][&window=24]
//   POST /kybernos-sessions/isolate     → creates OR reuses (idempotent, marked)
//   POST /kybernos-sessions/reclaim     → picks up the clean trees with no work
//   POST /kybernos-sessions/commit      → attributed commit + merge; it sends to GitHub only when
//                                          the body says `push:true` (L6-01: a bare POST stays local)
//   POST /kybernos-sessions/close-check → « can this session be closed? »
//                                          (same guards as the closing)
//   POST /kybernos-sessions/close       → merges, then removes the tree
//   POST /kybernos-sessions/push · /fetch · /sync · /pr
//   GET|POST /kybernos-sessions/settings   → ~/.dsh/kybernos/settings.json
//        (re-title at the end of a work session, the Study model `brain`, the
//         microphone source; the GET also says which Study model is in force: the
//         person's choice, the automatic one, or none — the page invents none)
//   GET  /kybernos-sessions/categories     → ~/.dsh/kybernos/categories.json
//        (the category of a session, written by the naming CLI: the chat list
//         draws it as an SVG, with no emoji in the title)
//   POST /kybernos-sessions/decision       → the CLOSED QUESTIONS, which the Study
//        model settles through DSH's `llm` service:
//        `{kybers:[{id,mission}],demande}` says which agent team handles the
//        request, `{categorie:"chat text"}` picks the session category (so the
//        icon of the row): the words of the title first (classement-local), the
//        model only when they say nothing. An answer is kept only if it is an id
//        of the closed list.
//
// The Study model is the person's `brain` setting; empty means Automatic (etude-auto.mjs).
// The pure functions are exported for the tests (test-*.mjs next to this file).
// ═══════════════════════════════════════════════════════════════════════════

import { execFile } from 'node:child_process'
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, rmSync, realpathSync, renameSync, chmodSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { creerSonde } from './brain-health.mjs'
import { excludedFrom, filterProbeable, readTrafficFile, trafficHealth } from './traffic-health.mjs'
import { dshHome, CATEGORIES } from './decision.mjs'
import { selectionnerKyber, selectionnerCategorie } from './decision-llm.mjs'
import { classerLocalement, estTitreAttente } from './classement-local.mjs'
import { choisirEtudeAuto, modelesConnectes, ecartesDe, garderConnectes } from './etude-auto.mjs'
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

// ── slug of the session store ⇄ path ───────────────────────────────────────
// The slug encodes the path ('/Users/me/projects/x' → '--Users-me-projects-x--')
// but the dash is ambiguous (it is the separator AND a legal character of a folder name).
// So it is resolved by existence: every possible cut, only the paths that exist are
// kept, the deepest wins.

export function slugSegments (slug) {
  const corps = slug.replace(/^--/, '').replace(/--$/, '')
  return corps.split('-').filter((s) => s.length > 0)
}

export function decodeSlugPath (slug, exists = existsSync) {
  const segs = slugSegments(slug)
  if (segs.length === 0) return null
  const candidats = []
  const marcher = (i, chemin) => {
    if (i >= segs.length) { candidats.push(chemin); return }
    for (let j = segs.length; j > i; j -= 1) {
      const morceau = segs.slice(i, j).join('-').replace(/~([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      const suite = chemin + '/' + morceau
      if (j === segs.length) candidats.push(suite)
      else if (exists(suite)) marcher(j, suite)
    }
  }
  marcher(0, '')
  const existants = candidats.filter(exists)
  if (existants.length === 0) return null
  return existants.sort((a, b) => b.length - a.length)[0]
}

// ── session store (~/.dsh/sessions) ─────────────────────────────────────────

// macOS drops a .DS_Store (a file) at the root of the store: the slug of a
// folder is ALWAYS a directory, otherwise `ls(join(home, slug))` throws
// ENOTDIR and the whole route answers 500.
function estDossier (chemin) {
  try { return statSync(chemin).isDirectory() } catch (e) { return false }
}

export function sessionsDuDossier (sessionsHome, slug, fenetreMs, maintenant = Date.now(), st = statSync, ls = readdirSync) {
  const dir = join(sessionsHome, slug)
  if (!existsSync(dir)) return []
  const sessions = []
  for (const nom of ls(dir)) {
    const sdir = join(dir, nom)
    const log = join(sdir, 'session.v3.jsonl.zstd')
    let logStat = null
    try { logStat = st(log) } catch (e) { continue /* not a session folder */ }
    sessions.push({
      id: nom.replace(/^session-/, ''),
      mtime: logStat.mtimeMs,
      actif: maintenant - logStat.mtimeMs <= fenetreMs
    })
  }
  return sessions
}

export function repartitionParDossier (sessionsHome, fenetreMs, maintenant = Date.now(), st = statSync, ls = readdirSync) {
  const dossiers = {}
  if (!existsSync(sessionsHome)) return dossiers
  for (const slug of ls(sessionsHome)) {
    if (!estDossier(join(sessionsHome, slug))) continue
    const sessions = sessionsDuDossier(sessionsHome, slug, fenetreMs, maintenant, st, ls)
    if (sessions.length === 0) continue
    const actifs = sessions.filter((s) => s.actif)
    dossiers[slug] = {
      sessionsTotal: sessions.length,
      sessionsActives: actifs.length,
      derniereActivite: Math.max(...sessions.map((s) => s.mtime))
    }
  }
  return dossiers
}

export function dossierDeSession (sessionsHome, sessionId, ls = readdirSync) {
  if (!existsSync(sessionsHome)) return null
  const cible = String(sessionId || '').replace(/^session-/, '')
  for (const slug of ls(sessionsHome)) {
    if (!estDossier(join(sessionsHome, slug))) continue
    for (const nom of ls(join(sessionsHome, slug))) {
      if (nom.replace(/^session-/, '') === cible) return slug
    }
  }
  return null
}

// ── git (execution; the reads never write) ──────────────────────────────────

// GIT_LITERAL_PATHSPECS: the only pathspecs this bundle hands to git are file names (`git add -- <the chat's files>`), and a name is literal. Without it a name that begins with `:`
// is read as pathspec magic: `chemins: ['mine.txt', ':/']` made `git add` take the whole repository, including the work of the other chats that `/commit` promises to leave out
// (recette 2026-10-25, L3-18). With it that entry is a file called `:/`, which does not exist, and the add is refused as a whole.
const gitRun = (args, cwd) => new Promise((res) => {
  execFile('git', args, { cwd, timeout: 15000, env: { ...process.env, GIT_LITERAL_PATHSPECS: '1' } }, (err, stdout, stderr) =>
    res({ ok: !err, out: String(stdout || ''), err: String(stderr || '') }))
})

// v3 « status light » — the same contract for gh (pull requests).
const ghRun = (args, cwd) => new Promise((res) => {
  execFile('gh', args, { cwd, timeout: 20000 }, (err, stdout, stderr) =>
    res({ ok: !err, out: String(stdout || ''), err: String(stderr || (err && err.message) || '') }))
})

// Cache of the gh reads (the page asks for the state every 30 s; gh takes a few
// hundred ms and adds nothing in a loop).
const cachePr = new Map() // path -> { t, val }
const git = gitRun

// ── What the git routes say ─────────────────────────────────────────────────
// Every reply of the git routes (isolate, reclaim, commit, close-check, close, push, fetch, sync, pr) keeps its JSON shape and
// carries a stable `code` (kebab-case). `erreur`, `message` and `note` are plain ENGLISH sentences built from the table below;
// what git or gh said itself travels apart, untranslated, in `detail` (a count in `count`, a branch in `base`). A client words
// the reply from its `code`, in its own language (kybernos-changes does), and falls back to the English sentence for a code it
// does not know. A code is added HERE and in the client table: kybernos-changes/test-client.mjs fails when the two drift.
export const GIT_TEXTS = {
  // the folder and the repository
  'folder-not-found': 'folder not found',
  'not-a-repo': 'not a git repository',
  'not-in-git': 'not in git — nothing to merge',
  'no-remote': 'no remote repository (origin) is set up',
  'no-github-remote': 'no GitHub remote (origin)',
  'not-a-copy': 'this folder is not a separate copy (worktree)',
  'is-a-copy': 'this folder is a separate copy (worktree) — reclaim runs from the main checkout',
  // saving
  'nothing-to-save': 'nothing to save — the folder is clean',
  'no-chat-files': 'no file belongs to this chat — the folder is changed by other chats, nothing to save here',
  'already-saved': 'already saved — nothing new in this chat’s files',
  'saved-local': 'saved on this computer (nothing sent)',
  'saved-merged-local': 'saved and merged into the local branch (nothing sent)',
  'saved-push-failed': 'saved on this computer — sending FAILED, the save still has to be sent',
  'saved-sent': 'saved and sent',
  'saved-sent-merged': 'saved, sent and merged into the base branch',
  'merged-local': 'merged into the local branch (nothing sent)',
  // GitHub
  'nothing-to-send': 'nothing to send — already up to date',
  'sent': 'sent to GitHub',
  'fetched': 'updates fetched — your files are unchanged',
  'synced': 'fetched, then sent — in sync',
  'current-is-base': 'the current branch is the base branch — give this chat its own copy first',
  'nothing-to-review': 'nothing to review — no commit beyond {base}',
  'pr-opened': 'pull request opened',
  'pr-merged': 'pull request merged into the base branch',
  // the separate copy (worktree)
  'already-isolated': 'already isolated — this folder is a worktree',
  'copy-created': 'copy created — open the NEXT chat in this folder to work in it',
  'copy-reused': 'a copy is already there and has no work — reused, nothing created',
  'copy-held': 'the copy is held by an open session',
  'copy-has-work': 'the existing copy has unsaved changes or work of its own',
  'merged-removed': 'merged and the separate copy removed',
  'copy-not-removed': 'copy not removed: {detail}',
  'clean-copy': 'clean copy — it can be merged, then removed',
  'main-folder': 'main folder — the session can be closed',
  'reclaimed': '{copies} without work removed',
  // what stands in the way
  'tree-dirty': 'unsaved changes ({files}) — save them first',
  'ignored-entries': 'closing would destroy {things} that cannot be regenerated ({entries})',
  'no-upstream': 'this branch was never sent to GitHub — send it first',
  'unpushed-commits': 'send first — {commits} not sent to GitHub yet',
  // what git or gh refused (their own words are in `detail`)
  'git-refused': 'git {step} refused: {detail}',
  'push-refused': 'push refused: {detail}',
  'fetch-refused': 'fetch refused: {detail}',
  'merge-refused': 'merge refused: {detail}',
  'gh-pr-create-refused': 'gh pr create refused: {detail}',
  'gh-pr-merge-refused': 'gh pr merge refused: {detail}'
}
const gitText = (code, p = {}) => String(GIT_TEXTS[code]).replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? String(p[k]) : m))
// The fields of `p` that ride along in the reply (the others only fill the sentence).
const gitExtras = (p) => Object.fromEntries(['detail', 'count', 'base', 'entries'].filter((k) => p[k] !== undefined).map((k) => [k, p[k]]))
const gitFail = (code, p = {}, extra = {}) => ({ ok: false, code, erreur: gitText(code, p), ...gitExtras(p), ...extra })
const gitDone = (code, p = {}, extra = {}) => ({ ok: true, ...extra, code, message: gitText(code, p), ...gitExtras(p) })
const countOf = (n, one, many) => n + ' ' + (n === 1 ? one : many)
const filesOf = (n) => ({ count: n, files: countOf(n, 'file', 'files') })
const commitsOf = (n) => ({ count: n, commits: countOf(n, 'commit', 'commits') })
const ignoredOf = (liste) => ({ count: liste.length, things: countOf(liste.length, 'ignored entry', 'ignored entries'), entries: liste.slice(0, 3).join(', ') })
// The words of a refusal, cut to a length a card can show.
const said = (r, n = 200) => String((r && r.err) || '').trim().slice(0, n)

// The paths of a `git status --porcelain`: « M file », « ?? folder/ »,
// « R  old -> new ». An untracked folder is rendered THAT way, with its trailing
// slash — hence `estSale`, which also recognises the files it holds: without it,
// a new file in a new folder passed for « already saved » and the commit was
// skipped in silence.
export function cheminsSales (out) {
  return String(out || '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '')
    .map((l) => l.slice(3).trim().replace(/^"/, '').replace(/"$/, '').split(' -> ').pop())
    .filter((p) => p !== '')
}
// The same paths WITH their `XY` code (« M », « ?? », « UU »…), to say what changed and not only where:
// the « Changes » plugin sorts them into modified / new / deleted / in conflict. An additive field of the state.
export function fichiersSales (out) {
  return String(out || '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '')
    .map((l) => ({ code: l.slice(0, 2).trim(), chemin: l.slice(3).trim().replace(/^"/, '').replace(/"$/, '').split(' -> ').pop() }))
    .filter((f) => f.chemin !== '')
}
export function estSale (sales, p) {
  return (Array.isArray(sales) ? sales : []).some((s) => {
    const brut = String(s)
    const t = brut.replace(/\/+$/, '')
    if (t === p) return true
    return brut.charAt(brut.length - 1) === '/' && p.indexOf(t + '/') === 0
  })
}

export async function etatGit (chemin, run = git) {
  const [branche, sale, avance, worktrees] = await Promise.all([
    run(['rev-parse', '--abbrev-ref', 'HEAD'], chemin),
    run(['status', '--porcelain'], chemin),
    run(['log', '--oneline', '@{upstream}..HEAD'], chemin),
    run(['rev-parse', '--git-dir'], chemin)
  ])
  if (!branche.ok) return { git: false }
  const gitdir = worktrees.out.trim()
  const estWorktree = /\.git\/worktrees\//.test(gitdir)
  // ── v3 « status light »: GitHub state (received), unmerged copy, base,
  // remote and last fetch — additive fields, the old ones stay identical.
  const [recul, distant, baseR] = await Promise.all([
    run(['rev-list', '--count', 'HEAD..@{upstream}'], chemin),
    run(['remote', 'get-url', 'origin'], chemin),
    run(['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], chemin)
  ])
  const base = baseR.ok && baseR.out.trim() !== ''
    ? baseR.out.trim().replace(/^origin\//, '')
    : ((await baseDuDepot(chemin, run)) || 'main')
  const fusion = estWorktree
    ? await run(['rev-list', '--count', base + '..HEAD'], chemin)
    : { ok: true, out: '0' }
  let dernierFetch = null
  for (const fd of [join(chemin, '.git', 'FETCH_HEAD'), join(gitdir, 'FETCH_HEAD')]) {
    try { dernierFetch = statSync(fd).mtime.toISOString(); break } catch (e) { /* no fetch yet */ }
  }
  return {
    git: true,
    branche: branche.out.trim(),
    modifications: sale.ok ? sale.out.split('\n').filter((l) => l.trim() !== '').length : -1,
    // The LIST of the dirty paths, not only their number: the Recap card can then
    // say « this chat's work is saved » by looking at the disk, even when the commit
    // went through the button (the journal only sees the commits an agent tool ran).
    sale: sale.ok ? cheminsSales(sale.out).slice(0, 200) : [],
    fichiers: sale.ok ? fichiersSales(sale.out).slice(0, 200) : [],
    commitsNonPousses: avance.ok ? avance.out.split('\n').filter((l) => l.trim() !== '').length : -1,
    commitsRecus: recul.ok ? parseInt(recul.out.trim(), 10) || 0 : -1,
    nonFusionnes: fusion.ok ? parseInt(fusion.out.trim(), 10) || 0 : -1,
    base,
    distant: distant.ok ? distant.out.trim() : null,
    worktree: estWorktree ? chemin : null,
    dernierFetch
  }
}

// ── Kybernos settings (~/.dsh/kybernos/settings.json) ──────────────────────
// The Settings popup writes here and the naming CLI READS here: this is the only contract that makes a switch of the GUI
// really obeyed by the agent (the agent has no access to the page's localStorage).
//
// Six keys: `renameAfterRecap` — re-title the session at the end of each recap (default: yes) — `brain`, the STUDY MODEL —
// `voiceInput`, the MICROPHONE SOURCE of the composer: the native control of the harness (`native`) or Kybernos's own
// (`kybernos`, default), which then takes its place — and the three of Auto routing (`autoRouting`, `autoWhitelist`,
// `autoClassifier`).
//
// The Study model is written `route/id`: exactly the identifier the Models page shows. It watches the configured models
// (health banner), judges the unclear cases of the Memory tidy-up and answers the closed questions (which agent team, which
// chat icon). Three states: a `route/id` is the person's choice, `none` is no Study model (nothing is watched and nothing is
// sent to a model for those questions), and EMPTY — the default — is Automatic: the model is picked from what the person
// connected (etude-auto.mjs). The key `decisionBrain` of the old « Decision Brain » setting is retired: it is accepted from
// an old page, ignored, and leaves the file at the next write.

export const REGLAGES_DEFAUT = { renameAfterRecap: true, brain: '', voiceInput: 'kybernos', autoRouting: false, autoWhitelist: [], autoClassifier: '' }

/** The Auto whitelist: an array of « route/id » identifiers (or route/key),
 *  without duplicates, capped at 64 entries — the only models Auto routing
 *  may pick for a delegation. */
const whitelistValide = (v) => Array.isArray(v) && v.length <= 64 &&
  v.every((x) => brainValide(x) === true) && new Set(v).size === v.length

/** The two dictation sources accepted. Any other value falls back to the default
 *  rather than writing a word the client could not render. */
export const VOICE_SOURCES = ['native', 'kybernos']
const voiceSourceValide = (v) => VOICE_SOURCES.indexOf(v) !== -1

/** A plausible `route/id` identifier, or the empty string. Deliberately WIDE:
 *  the host does NOT know the list of models (it lives in the client, which read
 *  it from the settings service), so it only refuses what cannot be an
 *  identifier — not what is not *the right one*. */
const brainValide = (v) => typeof v === 'string' && v.length <= 200
  && (v === '' || /^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:-]+$/.test(v))

/** The Study model takes one value more than an identifier: `none`, which switches it off without being confused with the
 *  empty value (Automatic). */
const etudeValide = (v) => (typeof v === 'string' && v === 'none') || brainValide(v)

// The six keys this page owns, normalised: anything missing or invalid falls
// back to its default.
const normalizeSettings = (j) => ({
  renameAfterRecap: j.renameAfterRecap !== false,
  brain: etudeValide(j.brain) === true ? j.brain : '',
  voiceInput: voiceSourceValide(j.voiceInput) === true ? j.voiceInput : REGLAGES_DEFAUT.voiceInput,
  autoRouting: j.autoRouting === true,
  autoWhitelist: whitelistValide(j.autoWhitelist) === true ? j.autoWhitelist : [],
  autoClassifier: brainValide(j.autoClassifier) === true ? j.autoClassifier : ''
})

// Tolerant read: a missing, unreadable or mangled file gives the defaults. A
// setting must NEVER make the page that shows it fail.
export function lireReglages (fichier) {
  let brut = null
  try { brut = JSON.parse(readFileSync(fichier, 'utf8')) } catch (e) { brut = null }
  return normalizeSettings((brut !== null && typeof brut === 'object') ? brut : {})
}

// ── Safe writer for settings.json ──────────────────────────────────────────
// The file is SHARED. Besides the six keys written here, the core bundle reads
// `pairingToken`, `gatewayBase` and `wsAdminKey` from it, kybernos-auto writes its
// own keys, and other bundles may add more. So a save is a MERGE, never a
// replace: read what is on disk, overlay the keys this page owns, keep every
// other key as it is. The write is atomic (temp file in the same directory, then
// rename), so a crash cannot leave half a file, and the file's permissions are
// kept: it holds secrets, so a file created here is 0600. If the file exists but
// is not a JSON object, nothing is written: a copy is kept next to it and the
// caller gets an error.

// KB-SETTINGS-FILE-BEGIN — the SAME text lives in packages/kybernos-sessions/index.js and
// packages/kybernos-auto/index.js (bundles ship one by one and cannot import each other);
// packages/kybernos-sessions/test-reglages.mjs fails if the two copies differ.
const CORRUPT_COPY_SUFFIX = '.corrupt-'
const CORRUPT_COPIES_MAX = 5

/** The raw object on disk: `{ raw }` (a missing or empty file is an empty object),
 *  `{ corrupt, text }` (present but not a JSON object) or `{ error }` (present but
 *  unreadable). */
function readRawSettings (file) {
  let text
  try { text = readFileSync(file, 'utf8') } catch (e) {
    if (e !== null && e !== undefined && e.code === 'ENOENT') return { raw: {} }
    return { error: 'settings.json cannot be read (' + (e && e.code ? e.code : 'unknown error') + '), so nothing was saved' }
  }
  if (text.trim() === '') return { raw: {} }
  let value
  try { value = JSON.parse(text) } catch (e) { return { corrupt: true, text } }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { corrupt: true, text }
  return { raw: value }
}

/** Keep a copy of a corrupt settings file next to it. A copy with the same content is
 *  reused, and there are never more than CORRUPT_COPIES_MAX copies, so repeated saves
 *  do not pile up files. Returns the copy's path or null. */
function keepCorruptCopy (file, text) {
  try {
    const folder = dirname(file)
    const prefix = basename(file) + CORRUPT_COPY_SUFFIX
    const copies = readdirSync(folder).filter((name) => name.startsWith(prefix))
    for (const name of copies) {
      try { if (readFileSync(join(folder, name), 'utf8') === text) return join(folder, name) } catch (e) { /* unreadable copy: ignored */ }
    }
    if (copies.length >= CORRUPT_COPIES_MAX) return null
    // Exclusive create ('wx'): two copies made in the same millisecond must never
    // overwrite each other, so a name that is taken gets a counter.
    const base = join(folder, prefix + Date.now())
    for (let i = 0; i < CORRUPT_COPIES_MAX; i += 1) {
      const copy = i === 0 ? base : base + '-' + i
      try { writeFileSync(copy, text, { mode: 0o600, flag: 'wx' }); return copy } catch (e) { if (!(e && e.code === 'EEXIST')) return null }
    }
    return null
  } catch (e) { return null }
}

/** Write `text` to `file` atomically, keeping an existing file's permissions (0600 for
 *  a new one). A symlinked settings.json stays a symlink: the target is replaced, not
 *  the link. Throws on failure, after removing its temp file. */
function writeFileAtomically (file, text) {
  let target = file
  try { target = realpathSync(file) } catch (e) { /* new file */ }
  let mode = 0o600
  try { mode = statSync(target).mode & 0o777 } catch (e) { /* new file: private by default */ }
  mkdirSync(dirname(target), { recursive: true })
  const temp = join(dirname(target), '.' + basename(target) + '.tmp-' + process.pid + '-' + Date.now())
  try {
    writeFileSync(temp, text, { mode })
    chmodSync(temp, mode) // the mode given to writeFileSync is masked by the umask
    renameSync(temp, target)
  } catch (e) {
    try { rmSync(temp, { force: true }) } catch (e2) { /* nothing left to clean */ }
    throw e
  }
}

/** The error to give back when the file on disk must NOT be overwritten (unreadable, or
 *  present but not a JSON object: a copy of it is kept), or null when writing is safe. */
function settingsFileBlocked (read, file) {
  if (read.error !== undefined) return read.error
  if (read.corrupt !== true) return null
  const copy = keepCorruptCopy(file, read.text)
  return 'settings.json is not a valid JSON object, so nothing was saved' +
    (copy === null ? '' : ' (a copy is kept as ' + basename(copy) + ')') +
    '. Fix or remove the file, then save again.'
}
// KB-SETTINGS-FILE-END
export { readRawSettings }

// Targeted write of known fields: never an object from the network as it is, and
// never a replacement of the keys other bundles keep in the same file.
export function ecrireReglages (fichier, patch) {
  const p = (patch !== null && typeof patch === 'object') ? patch : {}
  // A refused Study model is SAID: ignoring it in silence would let the page believe
  // the choice is saved while the file keeps the old one.
  // `invalide: true` marks a refusal of what was sent (the route answers 400); the others (a blocked or unwritable
  // settings.json) are the host's own trouble (500). `code` is the stable key a client words in its own language.
  if (p.brain !== undefined && etudeValide(p.brain) !== true) {
    return { ok: false, invalide: true, code: 'invalid-brain', erreur: 'brain: expected a “route/id” identifier, “none” or an empty string' }
  }
  if (p.voiceInput !== undefined && voiceSourceValide(p.voiceInput) !== true) {
    return { ok: false, invalide: true, code: 'invalid-voice-input', erreur: 'voiceInput: expected “native” or “kybernos”' }
  }
  if (p.autoWhitelist !== undefined && whitelistValide(p.autoWhitelist) !== true) {
    return { ok: false, invalide: true, code: 'invalid-auto-whitelist', erreur: 'autoWhitelist: expected an array of “route/id” identifiers without duplicates' }
  }
  const lu = readRawSettings(fichier)
  const bloque = settingsFileBlocked(lu, fichier)
  if (bloque !== null) return { ok: false, code: lu.error !== undefined ? 'settings-unreadable' : 'settings-corrupt', erreur: bloque }
  const avant = normalizeSettings(lu.raw)
  const apres = {
    renameAfterRecap: p.renameAfterRecap === undefined
      ? avant.renameAfterRecap
      : p.renameAfterRecap !== false,
    brain: p.brain === undefined ? avant.brain : p.brain,
    voiceInput: p.voiceInput === undefined ? avant.voiceInput : p.voiceInput,
    autoRouting: p.autoRouting === undefined ? avant.autoRouting : p.autoRouting === true,
    autoWhitelist: p.autoWhitelist === undefined ? avant.autoWhitelist : p.autoWhitelist,
    autoClassifier: p.autoClassifier === undefined ? avant.autoClassifier : p.autoClassifier
  }
  try {
    // Merge: every key already on disk stays, the six above are overlaid. The retired `decisionBrain` is the one key that goes.
    const reste = { ...lu.raw }
    delete reste.decisionBrain
    writeFileAtomically(fichier, JSON.stringify({ ...reste, ...apres }, null, 2) + '\n')
  } catch (e) { return { ok: false, code: 'settings-not-written', erreur: String(e && e.message ? e.message : e) } }
  return { ok: true, reglages: apres }
}

// ── session categories (~/.dsh/kybernos/categories.json) ────────────────────
// The title of a session carries NO emoji any more: the category (feature, fix,
// UI/design…) lives apart, indexed by session id, and the list draws it as an
// SVG. The naming CLI writes it; the client reads it here. The file is a plain
// object `{ "<sessionId>": { cat, titre, ts } }`.

// The accepted slugs — DERIVED from the table of the closed lists (decision.mjs), the only place where their MEANING is
// written (the criteria the Study model reads): a category added there is offered to the model and accepted by the route,
// with no second list to keep up to date. The order is that of the historical registry.
export const CATEGORIES_CONNUES = CATEGORIES.map((c) => c.slug)

export function lireCategories (fichier) {
  let brut = null
  try { brut = JSON.parse(readFileSync(fichier, 'utf8')) } catch (e) { brut = null }
  if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) return {}
  const propre = {}
  for (const id of Object.keys(brut)) {
    const e = brut[id]
    if (e === null || typeof e !== 'object') continue
    const cat = String(e.cat || '')
    if (CATEGORIES_CONNUES.indexOf(cat) === -1) continue
    // `auto`: a category set by the CLIENT (automatic classification of the initial
    // title), not by the naming agent. The agent can replace it at any time; auto
    // never re-classifies over an explicit naming.
    propre[id] = { cat, titre: String(e.titre || '').slice(0, 200), ts: String(e.ts || ''), auto: e.auto === true }
  }
  return propre
}

export function ecrireCategorie (fichier, sessionId, cat, titre, auto) {
  const id = String(sessionId || '').trim()
  if (id === '') return { ok: false, code: 'empty-session', erreur: 'empty session' }
  if (CATEGORIES_CONNUES.indexOf(String(cat)) === -1) {
    return { ok: false, code: 'unknown-category', erreur: 'unknown category: ' + String(cat) + ' (expected: ' + CATEGORIES_CONNUES.join(', ') + ')' }
  }
  const toutes = lireCategories(fichier)
  toutes[id] = { cat: String(cat), titre: String(titre || '').slice(0, 200), ts: new Date().toISOString(), auto: auto === true }
  try {
    mkdirSync(dirname(fichier), { recursive: true })
    writeFileSync(fichier, JSON.stringify(toutes, null, 2) + '\n')
  } catch (e) { return { ok: false, code: 'categories-not-written', erreur: String(e && e.message ? e.message : e) } }
  return { ok: true, id, categorisation: toutes[id] }
}

// ── memory of the agent teams (~/.dsh/kybers/<kyber>/memory) ────────────────

export function lignesJsonl (chemin) {
  if (!existsSync(chemin)) return []
  try {
    return readFileSync(chemin, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
  } catch (e) { return [] }
}

export function etatMemoire (kybersHome, ls = readdirSync) {
  const kybers = []
  if (!existsSync(kybersHome)) return kybers
  for (const nom of ls(kybersHome)) {
    const kdir = join(kybersHome, nom)
    if (!statSync(kdir).isDirectory()) continue
    const lecons = lignesJsonl(join(kdir, 'memory', 'lessons.jsonl'))
    const ledger = lignesJsonl(join(kdir, 'memory', 'ledger.jsonl'))
    if (lecons.length === 0 && ledger.length === 0) continue
    const membres = {}
    for (const e of ledger) {
      const r = e.role || '?'
      if (membres[r] === undefined) membres[r] = { runs: 0, dernier: null, outcome: null }
      membres[r].runs += 1
      if (e.ts && (membres[r].dernier === null || e.ts > membres[r].dernier)) {
        membres[r].dernier = e.ts
        membres[r].outcome = e.outcome || null
      }
    }
    const dernierLedger = ledger.length > 0 ? ledger[ledger.length - 1] : null
    kybers.push({
      id: nom,
      lecons: lecons.slice(-5).reverse().map((l) => ({ ts: l.ts, texte: l.text || '', tags: l.tags || [] })),
      totalLecons: lecons.length,
      totalRuns: ledger.length,
      derniereActivite: dernierLedger ? dernierLedger.ts : null,
      dernierOutcome: dernierLedger ? (dernierLedger.role + ' · ' + (dernierLedger.outcome || '')) : null,
      membres: Object.entries(membres).map(([role, m]) => ({ role, runs: m.runs, dernier: m.dernier, outcome: m.outcome }))
        .sort((a, b) => b.runs - a.runs)
    })
  }
  return kybers.sort((a, b) => String(b.derniereActivite || '').localeCompare(String(a.derniereActivite || '')))
}

// ── the full answer ─────────────────────────────────────────────────────────

export async function construireEtat ({ sessionsHome, kybersHome, sessionId, fenetreMs = 24 * 3600 * 1000, horloge = Date.now, run = git, ls = readdirSync, st = statSync, avecPr = false, gh = ghRun, cachePr: prCache = cachePr }) {
  const slug = sessionId ? dossierDeSession(sessionsHome, sessionId, ls) : null
  const repartition = repartitionParDossier(sessionsHome, fenetreMs, horloge(), st, ls)
  let session = null
  if (slug !== null) {
    const chemin = decodeSlugPath(slug)
    const dos = repartition[slug] || { sessionsActives: 0, sessionsTotal: 0, derniereActivite: 0 }
    const g = chemin ? await etatGit(chemin, run) : { git: false }
    // isolation worktrees present in this folder (a chat « born » here can be
    // isolated in one: its activity no longer threatens the main folder)
    let nbWorktrees = 0
    if (chemin !== null) {
      const wdir = join(chemin, '.worktrees')
      if (existsSync(wdir)) nbWorktrees = readdirSync(wdir).filter((n) => estDossier(join(wdir, n))).length
    }
    session = {
      slug,
      chemin,
      sessionsActives: dos.sessionsActives,
      sessionsTotal: dos.sessionsTotal,
      worktrees: nbWorktrees,
      etat: g.git
        ? (dos.sessionsActives >= 2 && nbWorktrees === 0
            ? 'error'
            : (dos.sessionsActives >= 2 || g.modifications > 0 || g.commitsNonPousses > 0 ? 'warning' : 'done'))
        : 'idle',
      git: g
    }
    // ── v3 « status light »: GitHub state of the PROJECT (in a worktree, the sync
    // pill describes the main folder — an isolated copy stays on the computer)
    // and pull request of the current branch (gh, cached for 60 s).
    if (g.git) {
      const sd = g.worktree
        ? await etatGit(String(chemin).replace(/\/\.worktrees\/[^/]+$/, ''), run)
        : g
      session.sync = g.worktree && sd.git
        ? { branche: sd.branche, commitsNonPousses: sd.commitsNonPousses, commitsRecus: sd.commitsRecus, distant: sd.distant, dernierFetch: sd.dernierFetch }
        : { branche: g.branche, commitsNonPousses: g.commitsNonPousses, commitsRecus: g.commitsRecus, distant: g.distant, dernierFetch: g.dernierFetch }
      session.pr = avecPr ? await etatPr(chemin, { gh, cache: prCache, horloge }) : null
    }
  }
  return { session, kybers: etatMemoire(kybersHome, ls) }
}


// ── « can the session be closed? » — READ only ──────────────────────────────
// The same guards as `cloturer`, but with no write at all: the summary of the
// local pill says what is left to do instead of letting a click find out.
//   · outside git, or main folder → can be closed (nothing to merge);
//   · isolated copy → it needs a clean tree, a pushed branch, and no ignored
//     entry that cannot be regenerated (`.env`, local database…) which closing
//     would destroy.
// `code` is the reply's stable key (the first problem's, or the good news'); `raison` and `erreurs` are English sentences.
export async function sondeCloture ({ chemin, run = gitRun, forceIgnores = false }) {
  if (!chemin || !existsSync(chemin)) { const t = gitText('folder-not-found'); return { ok: false, cloturable: false, worktree: false, code: 'folder-not-found', raison: t, erreurs: [t] } }
  const g = await etatGit(chemin, run)
  if (!g.git) return { ok: true, cloturable: true, worktree: false, branche: null, code: 'not-in-git', raison: gitText('not-in-git'), erreurs: [] }
  const gd = await run(['rev-parse', '--git-dir'], chemin)
  const estWt = /\.git\/worktrees\//.test(String(gd.out))
  if (!estWt) return { ok: true, cloturable: true, worktree: false, branche: g.branche, code: 'main-folder', raison: gitText('main-folder'), erreurs: [] }
  const problemes = [] // [code, parameters]
  if (g.modifications > 0) problemes.push(['tree-dirty', filesOf(g.modifications)])
  const ig = await run(['status', '--porcelain', '--ignored=matching'], chemin)
  const precieux = ig.ok ? ignoresPrecieux(String(ig.out)) : []
  if (precieux.length > 0 && forceIgnores !== true) problemes.push(['ignored-entries', ignoredOf(precieux)])
  const pousse = await run(['rev-list', '--count', '@{upstream}..' + g.branche], chemin)
  if (!pousse.ok) problemes.push(['no-upstream', {}])
  else if (String(pousse.out).trim() !== '0') problemes.push(['unpushed-commits', commitsOf(parseInt(String(pousse.out).trim(), 10) || 0)])
  const erreurs = problemes.map(([code, p]) => gitText(code, p))
  return {
    ok: true,
    cloturable: erreurs.length === 0,
    worktree: true,
    branche: g.branche,
    nonFusionnes: g.nonFusionnes,
    code: problemes.length === 0 ? 'clean-copy' : problemes[0][0],
    raison: erreurs.length === 0 ? gitText('clean-copy') : erreurs[0],
    erreurs
  }
}

// ── protected actions (dry run by default, exec only on confirmation) ───────

// ── isolation: life cycle of the worktrees ──────────────────────────────────
// A tree that was created must be REUSABLE (never twice the same name), MARKED
// (purpose + date, written NEXT TO the tree so as not to dirty it) and
// RECLAIMABLE (removed as soon as it is clean and has no work). Without these
// three properties an automatic guard makes dead trees on every call — seen on
// 21/09/2026: two `.worktrees/s-mub*` trees at 0 commits ahead, 0 behind, clean
// tree, and a third already reported « left, redundant ».

const normaliserSlug = (nom) => (nom || ('s-' + Date.now().toString(36)))
  .replace(/[^a-z0-9-]/gi, '-').slice(0, 40)

const dossierMarqueur = (chemin) => join(chemin, '.worktrees')
const cheminMarqueur = (chemin, slug) => join(dossierMarqueur(chemin), slug + '.kybernos.json')

export function lireMarqueur (chemin, slug) {
  try { return JSON.parse(readFileSync(cheminMarqueur(chemin, slug), 'utf8')) } catch (e) { return {} }
}
function ecrireMarqueur (chemin, slug, data) {
  try {
    mkdirSync(dossierMarqueur(chemin), { recursive: true })
    writeFileSync(cheminMarqueur(chemin, slug), JSON.stringify({ version: 1, ...data }) + '\n')
  } catch (e) { /* a missing marker does not block the isolation */ }
}
function effacerMarqueur (chemin, slug) {
  try { rmSync(cheminMarqueur(chemin, slug), { force: true }) } catch (e) { /* already gone */ }
}

// `.worktrees/` goes into the repository's LOCAL exclusion (info/exclude, never
// committed): without it the folder of trees counts as untracked and the
// « dirty tree » guard of the isolation would trigger on its own product.
export async function exclureWorktrees ({ chemin, run = gitRun }) {
  const gd = await run(['rev-parse', '--path-format=absolute', '--git-common-dir'], chemin)
  const dir = gd.ok && String(gd.out).trim() !== '' ? String(gd.out).trim() : join(chemin, '.git')
  try {
    const excl = join(dir, 'info', 'exclude')
    const avant = existsSync(excl) ? readFileSync(excl, 'utf8') : ''
    if (!/^\.worktrees\/?\s*$/m.test(avant)) {
      mkdirSync(join(dir, 'info'), { recursive: true })
      appendFileSync(excl, (avant === '' || avant.endsWith('\n') ? '' : '\n') + '.worktrees/\n')
    }
    return { ok: true, chemin: excl }
  } catch (e) { return { ok: false, erreur: String(e && e.message ? e.message : e) } }
}

// The encoding of the store is a DSH CONVENTION, not a contract: every character
// outside [a-zA-Z0-9-] becomes `~XXXX` (space → ~0020, dot → ~002e) and every
// « / » becomes « - ». Building it by hand missed every session whose folder
// holds an encoded character: the real store carries
// `--Users-me-Library-Application~0020Support-Open~0020Design-…--`. A « not
// seen » session = a HELD tree taken for a free tree, hence removed by the
// reclaim. So we encode, and fall back on decoding the store if the direct name
// does not exist.
export function encoderSlugChemin (chemin) {
  const corps = String(chemin).replace(/^\/+/, '').split('/')
    .map((seg) => seg.replace(/[^a-zA-Z0-9-]/g, (c) => '~' + c.codePointAt(0).toString(16).padStart(4, '0')))
    .join('-')
  return '--' + corps + '--'
}

export function slugsDeChemin (sessionsHome, chemin, ls = readdirSync) {
  if (!sessionsHome || !chemin) return []
  const direct = encoderSlugChemin(chemin)
  if (existsSync(join(sessionsHome, direct))) return [direct]
  try { return ls(sessionsHome).filter((n) => decodeSlugPath(n) === chemin) } catch (e) { return [] }
}

// A session open on this tree forbids reclaiming it: a folder where a chat is
// writing right now is never removed (the same rule as the closing).
export function estTenue (sessionsHome, chemin, fenetreMs = 3600 * 1000, maintenant = Date.now(), st = statSync, ls = readdirSync) {
  if (!sessionsHome || !chemin) return false
  return slugsDeChemin(sessionsHome, chemin, ls)
    .some((slug) => sessionsDuDossier(sessionsHome, slug, fenetreMs, maintenant, st, ls).some((s) => s.actif))
}

// Not every ignored entry is worth the same. `node_modules/`, `dist/`,
// `.DS_Store` are REGENERABLE: treating them as work would make the reclaim
// useless — any tree where `npm install` was run would stay forever, and a SINGLE
// `.DS_Store` (a Finder side effect) was enough to block the recovery (measured
// on 21/09/2026). `.env`, a draft or a local database are not: those cannot be
// rebuilt. So this is a list of REGENERABLE entries, and everything not in it is
// presumed PRECIOUS — the default is conservative.
const IGNORES_REGENERABLES = new Set([
  'node_modules', 'dist', 'build', 'out', 'target', 'coverage', 'vendor',
  '.cache', '.parcel-cache', '.next', '.nuxt', '.turbo', '.svelte-kit',
  '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  '.gradle', '.idea', '.vscode', '.sass-cache', '.terraform', '.worktrees',
  '.DS_Store', 'tmp', '.tmp'
])

export function ignoresPrecieux (porcelainIgnore) {
  return String(porcelainIgnore).split('\n')
    .filter((l) => l.startsWith('!! '))
    .map((l) => l.slice(3).trim().replace(/^"/, '').replace(/"$/, ''))
    .map((p) => (p.endsWith('/') ? p.slice(0, -1) : p))
    .filter((p) => p !== '')
    .filter((p) => {
      const feuille = p.split('/').pop()
      return !IGNORES_REGENERABLES.has(feuille) && !/\.log$/.test(feuille)
    })
}

// The base of a trunk is not always `main`: `origin/HEAD` first (what the
// repository declares), then the usual names, then the current branch. Without
// this a repository on `master` kept ALL its trees (« base main not found ») and
// the reclaim reclaimed nothing — exactly the harm it is meant to repair.
export async function baseDuDepot (chemin, run = gitRun) {
  const tete = await run(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], chemin)
  if (tete.ok) {
    const m = String(tete.out).trim().match(/^refs\/remotes\/origin\/(.+)$/)
    if (m !== null) return m[1]
  }
  for (const c of ['main', 'master', 'dev']) {
    const r = await run(['show-ref', '--verify', '--quiet', 'refs/heads/' + c], chemin)
    if (r.ok) return c
  }
  const cur = await run(['rev-parse', '--abbrev-ref', 'HEAD'], chemin)
  const nom = cur.ok ? String(cur.out).trim() : ''
  return nom === '' || nom === 'HEAD' ? null : nom
}

export async function worktreesEnregistres (chemin, run = gitRun) {
  const r = await run(['worktree', 'list', '--porcelain'], chemin)
  if (!r.ok) return []
  const out = []
  for (const bloc of String(r.out).split('\n\n')) {
    const l = bloc.split('\n')
    const p = (l.find((x) => x.startsWith('worktree ')) || '').slice(9).trim()
    if (p === '') continue
    out.push({
      chemin: p,
      branche: (l.find((x) => x.startsWith('branch ')) || 'branch (detached)').slice(7).trim(),
      slug: p.includes('/.worktrees/') ? p.split('/.worktrees/').pop() : null
    })
  }
  return out
}

// Read only: what would the isolation do? The guard uses it BEFORE writing,
// never to create a second tree while the first is still free.
export async function sondeIsolation ({ chemin, nom, run = gitRun, sessionsHome = null, fenetreMs = 3600 * 1000 }) {
  if (!chemin || !existsSync(chemin)) return gitFail('folder-not-found', {}, { ok: false, git: false })
  const g = await etatGit(chemin, run)
  if (!g.git) return gitFail('not-a-repo', {}, { ok: false, git: false })
  if (g.worktree) return { ok: true, git: true, dejaIsole: true, cible: chemin, branche: g.branche }
  const slug = normaliserSlug(nom)
  const cible = join(chemin, '.worktrees', slug)
  const branche = 'feature/' + slug
  if (existsSync(cible)) {
    const r = await etatGit(cible, run)
    const tenue = estTenue(sessionsHome, cible, fenetreMs)
    const libre = r.git && r.worktree && r.modifications === 0 && r.nonFusionnes === 0 && !tenue
    return {
      ok: libre, git: true, dejaIsole: false, reutilisable: libre, cible,
      branche: r.git ? r.branche : branche,
      ...(libre ? {} : gitFail(tenue ? 'copy-held' : 'copy-has-work'))
    }
  }
  // The trunk must be clean TO CREATE: a tree is born from HEAD and would leave
  // the uncommitted changes behind. This does not concern reusing a tree that is
  // already in place (handled just above).
  //
  // `.worktrees/` is filtered HERE, read only: the folder of trees is the product
  // of this module, it must not make the creation refuse. The old version got the
  // same effect by writing into `info/exclude` BEFORE probing — so even in a dry
  // run (a broken contract). The exclusion is still written, but only when we
  // really execute.
  const brut = await run(['status', '--porcelain'], chemin)
  const lignes = brut.ok ? String(brut.out).split('\n').filter((l) => l.trim() !== '') : []
  const horsArbres = lignes.filter((l) => !/(^|\s)\.worktrees\//.test(l))
  if (horsArbres.length > 0) return gitFail('tree-dirty', filesOf(horsArbres.length), { ok: false, git: true, sale: true, cible, branche })
  return { ok: true, git: true, dejaIsole: false, reutilisable: false, cible, branche }
}

export async function isoler ({ chemin, nom, but, exec = false, run = gitRun, sessionsHome = null, fenetreMs = 3600 * 1000 }) {
  if (!chemin || !existsSync(chemin)) return gitFail('folder-not-found')
  const s = await sondeIsolation({ chemin, nom, run, sessionsHome, fenetreMs })
  if (s.dejaIsole) return gitDone('already-isolated', {}, { dejaIsole: true, cible: s.cible, branche: s.branche })
  if (!s.ok) return { ok: false, code: s.code, erreur: s.erreur, ...(s.count !== undefined ? { count: s.count } : {}) }
  // The exclusion is only written AFTER a favourable probe: a REFUSED isolation
  // (dirty trunk) must leave no trace in the repository.
  if (exec) await exclureWorktrees({ chemin, run })
  if (s.reutilisable) {
    if (!exec) return { ok: true, dry: true, reutilise: true, cible: s.cible, branche: s.branche, commandes: [] }
    return gitDone('copy-reused', {}, { reutilise: true, cible: s.cible, branche: s.branche })
  }
  // A `feature/<slug>` branch can outlive the reclaim of its tree: reusing it
  // instead of re-creating it (`-b`) is what keeps `isoler` idempotent at the
  // border of the reclaim, without assuming the reclaim cleaned everything.
  const existe = await run(['show-ref', '--verify', '--quiet', 'refs/heads/' + s.branche], chemin)
  const brancheExistante = existe.ok
  const commandes = [brancheExistante
    ? ['worktree', 'add', s.cible, s.branche]
    : ['worktree', 'add', '-b', s.branche, s.cible]]
  if (!exec) {
    return { ok: true, dry: true, commandes: commandes.map((c) => 'git ' + c.join(' ')), cible: s.cible, branche: s.branche, brancheExistante }
  }
  const r = await run(commandes[0], chemin)
  if (!r.ok) return gitFail('git-refused', { step: 'worktree add', detail: said(r) })
  const g = await etatGit(chemin, run)
  const base = await baseDuDepot(chemin, run)
  ecrireMarqueur(chemin, normaliserSlug(nom), {
    but: but || null, branche: s.branche, base: base || g.base || null,
    ne: new Date().toISOString(), par: 'kybernos-sessions/isoler'
  })
  return gitDone('copy-created', {}, { cible: s.cible, branche: s.branche })
}

// Reclaims the CLEAN isolation trees with NO WORK (0 commits beyond the base).
// Never touches: a dirty tree, a tree that is ahead, a tree held by an open
// session, a folder outside `.worktrees/`. Dry run by default.
// `gardes[].raison` and `candidats[].raison` are English sentences for a person or an agent to read.
export async function ramasser ({ chemin, exec = false, run = gitRun, sessionsHome = null, fenetreMs = 3600 * 1000, base = null, forceIgnores = false }) {
  if (!chemin || !existsSync(chemin)) return gitFail('folder-not-found')
  const g = await etatGit(chemin, run)
  if (!g.git) return gitFail('not-a-repo')
  if (g.worktree) return gitFail('is-a-copy')
  const b = base || (await baseDuDepot(chemin, run)) || g.base || 'main'
  const candidats = []
  const gardes = []
  for (const w of await worktreesEnregistres(chemin, run)) {
    if (w.chemin.replace(/\/+$/, '') === String(chemin).replace(/\/+$/, '')) continue
    if (w.slug === null) { gardes.push({ chemin: w.chemin, raison: 'outside .worktrees/' }); continue }
    const branche = String(w.branche || '').replace(/^refs\/heads\//, '')
    if (!existsSync(w.chemin)) {
      candidats.push({ chemin: w.chemin, slug: w.slug, branche, brancheRetirable: await brancheRetirable(chemin, branche, b, run), raison: 'folder absent' })
      continue
    }
    if (estTenue(sessionsHome, w.chemin, fenetreMs)) { gardes.push({ chemin: w.chemin, raison: 'held by an open session' }); continue }
    const st = await run(['status', '--porcelain'], w.chemin)
    if (!st.ok || String(st.out).trim() !== '') { gardes.push({ chemin: w.chemin, raison: 'dirty tree' }); continue }
    // `--porcelain` does NOT count ignored files: a tree whose only uncommitted
    // content is ignored (a draft, a local database, `.env`) looks clean,
    // `worktree remove` succeeds, and that content is DESTROYED. So we keep it —
    // but only for what cannot be regenerated, otherwise the reclaim would
    // reclaim nothing any more (see `IGNORES_REGENERABLES`).
    const ig = await run(['status', '--porcelain', '--ignored=matching'], w.chemin)
    const precieux = ig.ok ? ignoresPrecieux(String(ig.out)) : []
    if (precieux.length > 0 && forceIgnores !== true) {
      gardes.push({ chemin: w.chemin, raison: countOf(precieux.length, 'ignored entry', 'ignored entries') + ' that cannot be regenerated — --force-ignores to destroy them', ignores: precieux.slice(0, 5) })
      continue
    }
    const av = await run(['rev-list', '--count', b + '..HEAD'], w.chemin)
    const n = av.ok ? (parseInt(String(av.out).trim(), 10) || 0) : -1
    if (n !== 0) { gardes.push({ chemin: w.chemin, raison: n < 0 ? 'base “' + b + '” not found' : countOf(n, 'commit', 'commits') + ' beyond ' + b }); continue }
    candidats.push({ chemin: w.chemin, slug: w.slug, branche, brancheRetirable: await brancheRetirable(chemin, branche, b, run), but: lireMarqueur(chemin, w.slug).but || null })
  }
  const commandes = candidats.flatMap((c) => ['git worktree remove ' + c.chemin]
    .concat(c.brancheRetirable ? ['git branch -D ' + c.branche] : []))
  if (!exec) return { ok: true, dry: true, base: b, candidats, gardes, commandes }
  const retires = []
  const branchesRetirees = []
  for (const c of candidats) {
    const r = await run(['worktree', 'remove', c.chemin], chemin)
    if (!r.ok && existsSync(c.chemin)) {
      gardes.push({ chemin: c.chemin, raison: 'remove refused: ' + said(r, 120) })
      continue
    }
    retires.push(c.chemin)
    effacerMarqueur(chemin, c.slug)
    if (c.brancheRetirable) {
      const br = await run(['branch', '-D', c.branche], chemin)
      if (br.ok) branchesRetirees.push(c.branche)
    }
  }
  const pr = await run(['worktree', 'prune'], chemin)
  return gitDone('reclaimed', { copies: countOf(retires.length, 'copy', 'copies'), count: retires.length }, { base: b, retires, branchesRetirees, gardes, prune: pr.ok })
}

// A `feature/<slug>` branch can only be deleted if it carries NO commit beyond
// the base: everything is already in the base, only a reference is removed.
// Without this cleaning, an `isoler` of the same name failed after a reclaim
// (« a branch named … already exists ») — the idempotence broke exactly at the
// border of the reclaim.
async function brancheRetirable (chemin, branche, base, run) {
  if (branche === '' || branche === base) return false
  const cnt = await run(['rev-list', '--count', base + '..' + branche], chemin)
  return cnt.ok && String(cnt.out).trim() === '0'
}

export async function cloturer ({ chemin, exec = false, run = gitRun, forceIgnores = false }) {
  if (!chemin || !existsSync(chemin)) return gitFail('folder-not-found')
  const g = await etatGit(chemin, run)
  if (!g.git) return gitFail('not-a-repo')
  const gd = await run(['rev-parse', '--git-dir'], chemin)
  if (!/\.git\/worktrees\//.test(String(gd.out))) return gitFail('not-a-copy')
  if (g.modifications > 0) return gitFail('tree-dirty', filesOf(g.modifications))
  // Closing DESTROYS the tree: the ignored entries that cannot be regenerated (`.env`, local
  // database) would disappear without `git status` having signalled anything. The same guard as
  // the reclaim, the same explicit valve (`forceIgnores: true` in the request).
  const ig = await run(['status', '--porcelain', '--ignored=matching'], chemin)
  const precieux = ig.ok ? ignoresPrecieux(String(ig.out)) : []
  if (precieux.length > 0 && forceIgnores !== true) return gitFail('ignored-entries', ignoredOf(precieux))
  const branche = g.branche
  const pousse = await run(['rev-list', '--count', '@{upstream}..' + branche], chemin)
  if (!pousse.ok) return gitFail('no-upstream')
  if (String(pousse.out).trim() !== '0') return gitFail('unpushed-commits', commitsOf(parseInt(String(pousse.out).trim(), 10) || 0))
  const racine = await run(['rev-parse', '--show-toplevel'], chemin)
  const principal = String(racine.out).trim().replace(/\/.worktrees\/[^/]+$/, '')
  const commandes = [
    ['merge', '--no-ff', '-m', 'merge: ' + branche, branche],
    ['worktree', 'remove', chemin]
  ]
  if (!exec) {
    return { ok: true, dry: true, branche,
      commandes: ['cd ' + principal + ' && git ' + commandes[0].join(' '), 'git ' + commandes[1].join(' ')] }
  }
  const m = await run(commandes[0], principal)
  if (!m.ok) return gitFail('merge-refused', { detail: said(m) })
  const w = await run(commandes[1], principal)
  if (!w.ok) return gitFail('copy-not-removed', { detail: said(w) })
  if (chemin.startsWith(join(principal, '.worktrees') + '/')) effacerMarqueur(principal, basename(chemin))
  return gitDone('merged-removed', {}, { branche })
}


// commit (+ push, + merge if in a worktree) — dry run by default, identical guards
// `chemins`: the list of the files written BY THIS CHAT (its journal knows it).
// When given, it replaces `git add -A` — on a folder shared by eight chats,
// `-A` takes the others' work in progress into the commit and pushes it.
// Given AND EMPTY, it means « this chat wrote nothing »: we refuse, instead of
// committing somebody else's folder.
/** Pure. Whether a body of `/commit` asks to send to GitHub: only an explicit `push:true`, never `local:true`. A bare POST (a script, a curl) commits on this computer and sends nothing (L6-01). */
export const veutPousser = (corps) => corps !== null && typeof corps === 'object' && corps.push === true && corps.local !== true
export async function commiter ({ chemin, message, exec = false, run = gitRun, chemins = null, pousser: pousserAussi = true }) {
  if (!chemin || !existsSync(chemin)) return gitFail('folder-not-found')
  const g = await etatGit(chemin, run)
  if (!g.git) return gitFail('not-a-repo')
  const gd = await run(['rev-parse', '--git-dir'], chemin)
  const estWt = /\.git\/worktrees\//.test(String(gd.out))
  let principal = null
  if (estWt) {
    const racine = await run(['rev-parse', '--show-toplevel'], chemin)
    principal = String(racine.out).trim().replace(/\/.worktrees\/[^/]+$/, '')
  }
  // LOCAL mode (`pousser:false`): nothing goes to GitHub. A clean tree is then not
  // a dead end — if commits are left to bring back into the base branch,
  // « local commit & merge » does the merge alone. This is the gesture of the quick
  // button: the work stays on the machine, the main folder sees it.
  if (g.modifications <= 0) {
    if (pousserAussi === false && estWt && g.nonFusionnes > 0) {
      const commandes = [['merge', '--no-ff', '-m', 'merge: ' + g.branche, g.branche]]
      if (!exec) {
        return { ok: true, dry: true, local: true, mergeSeul: true, worktree: true, branche: g.branche,
          message: 'local merge of ' + g.branche, commandes: ['git ' + commandes[0].join(' ')] }
      }
      const m = await run(commandes[0], principal)
      if (!m.ok) return gitFail('merge-refused', { detail: said(m) })
      return gitDone('merged-local', {}, { local: true, mergeSeul: true, worktree: true, branche: g.branche })
    }
    return gitFail('nothing-to-save')
  }
  const msg = (message && message.trim() !== '') ? message.trim().slice(0, 200) : 'delivery ' + new Date().toISOString().slice(0, 16).replace('T', ' ')
  const scope = Array.isArray(chemins)
  // The paths come from the session's journal: they are written there as the
  // tool received them — so OFTEN absolute (`/Users/…/scripts/foo.mjs`), since
  // that is how the agent names its files. Refusing them wholesale made a chat
  // that had just written fifty-eight of them answer « no file attributed to
  // this chat ». So they are brought back RELATIVE when they are under the root
  // of the repository, and the rest is dropped: outside the repository (the
  // machine's configuration files) or an attempt to climb up (`..`).
  const racine = (await run(['rev-parse', '--show-toplevel'], chemin)).out
  const brut = String(racine || '').trim().replace(/\/$/, '')
  const reelDe = (p) => { try { return realpathSync(p) } catch (e) { return null } }
  const sous = (base, p) => (base !== '' && p !== base && p.indexOf(base + '/') === 0 ? p.slice(base.length + 1) : null)
  const relatif = (c) => {
    if (c === '') return null
    if (c.charAt(0) !== '/') return c.split('/').includes('..') ? null : c
    // macOS: /var is a link to /private/var. The journal may name the path
    // through the link when git gives the resolved root (or the reverse): so we
    // compare the text AND the real paths. No base being a symlink to the
    // outside, we cannot get out of the repository this way.
    const bases = [brut, reelDe(brut)].filter((b) => b !== null && b !== '')
    const formes = [c, reelDe(c)].filter((p) => p !== null)
    for (const base of bases) for (const p of formes) { const s = sous(base, p); if (s !== null) return s }
    return null
  }
  const retenus = scope
    ? chemins.map((c) => relatif(String(c).trim()))
        .filter((c) => c !== null && c !== '')
        .filter((c, i, t) => t.indexOf(c) === i)
        .slice(0, 200)
    : []
  if (scope && retenus.length === 0) return gitFail('no-chat-files')
  const sales = Array.isArray(g.sale) ? g.sale : []
  // Already saved: the button was used, or a commit went through another path.
  // Say so, instead of letting `git commit` fail on « nothing added to commit »
  // — which is what the second click did.
  if (scope && retenus.length > 0 && retenus.every((p) => estSale(sales, p) === false)) {
    return gitDone('already-saved', {}, { deja: true, chemins: retenus, laisses: sales })
  }
  const commandes = [scope ? ['add', '--', ...retenus] : ['add', '-A'], ['commit', '-m', msg]]
  if (pousserAussi !== false) commandes.push(['push'])
  // What the `add` leaves aside: the others' work, said in black and white.
  const st = await run(['status', '--porcelain'], chemin)
  const tous = st.ok ? cheminsSales(st.out) : sales
  const laisses = scope ? tous.filter((p) => estSale(retenus, p) === false) : []
  if (estWt) {
    commandes.push(['merge', '--no-ff', '-m', 'merge: ' + g.branche, g.branche])
  }
  if (!exec) {
    return { ok: true, dry: true, local: pousserAussi === false, message: msg, worktree: estWt, scope, chemins: retenus, laisses,
      commandes: commandes.map((c) => 'git ' + c.join(' ')) }
  }
  // S-02: a failure of `git push` is no longer SWALLOWED — the local commit
  // succeeded (ok:true) but the state of the push is returned, not kept quiet.
  // On success `message` is the commit message (what was typed, or the default one); the sentence is `note`, with its `code`.
  let pushRate = null
  for (const c of commandes) {
    if (c[0] === 'merge') {
      const m = await run(c, principal)
      if (!m.ok) return gitFail('merge-refused', { detail: said(m) })
    } else {
      const r = await run(c, chemin)
      if (!r.ok && c[0] !== 'push') return gitFail('git-refused', { step: c[0], detail: said(r) })
      if (!r.ok && c[0] === 'push') pushRate = said(r)
    }
  }
  if (pousserAussi === false) {
    const code = estWt ? 'saved-merged-local' : 'saved-local'
    return { ok: true, code, local: true, message: msg, worktree: estWt, note: gitText(code) }
  }
  if (pushRate !== null) {
    return { ok: true, code: 'saved-push-failed', pousse: false, message: msg, worktree: estWt, erreurPush: pushRate, note: gitText('saved-push-failed') }
  }
  const code = estWt ? 'saved-sent-merged' : 'saved-sent'
  return { ok: true, code, pousse: true, message: msg, worktree: estWt, note: gitText(code) }
}

// ── GitHub: push / fetch / pull requests (gh) ───────────────────────────────
// The same contracts as isoler/commiter/cloturer: dry run first (plan of
// commands), execution on exec:true. Read only on the state side.

export async function pousser ({ chemin, exec = false, run = gitRun }) {
  if (!chemin || !existsSync(chemin)) return gitFail('folder-not-found')
  const g = await etatGit(chemin, run)
  if (!g.git) return gitFail('not-a-repo')
  if (!g.distant) return gitFail('no-remote')
  if (g.commitsNonPousses === 0) return gitFail('nothing-to-send')
  if (!exec) return { ok: true, dry: true, commandes: ['git push'] }
  const r = await run(['push'], chemin)
  if (!r.ok) return gitFail('push-refused', { detail: said(r) })
  return gitDone('sent')
}

export async function rapatrier ({ chemin, exec = false, run = gitRun }) {
  if (!chemin || !existsSync(chemin)) return gitFail('folder-not-found')
  const g = await etatGit(chemin, run)
  if (!g.git) return gitFail('not-a-repo')
  if (!g.distant) return gitFail('no-remote')
  if (!exec) return { ok: true, dry: true, commandes: ['git fetch'] }
  const r = await run(['fetch'], chemin)
  if (!r.ok) return gitFail('fetch-refused', { detail: said(r) })
  return gitDone('fetched')
}

export async function synchroniser ({ chemin, exec = false, run = gitRun }) {
  if (!chemin || !existsSync(chemin)) return gitFail('folder-not-found')
  const g = await etatGit(chemin, run)
  if (!g.git) return gitFail('not-a-repo')
  if (!g.distant) return gitFail('no-remote')
  if (!exec) return { ok: true, dry: true, commandes: ['git fetch', 'git push'] }
  const f = await run(['fetch'], chemin)
  if (!f.ok) return gitFail('fetch-refused', { detail: said(f) })
  const p = await run(['push'], chemin)
  if (!p.ok) return gitFail('push-refused', { detail: said(p) })
  return gitDone('synced')
}

// ── pull requests through gh (CLI, reads + actions) ─────────────────────────

export async function etatPr (chemin, { gh = ghRun, cache = cachePr, duree = 60000, horloge = Date.now } = {}) {
  if (!chemin || !existsSync(chemin)) return null
  const c = cache.get(chemin)
  if (c && horloge() - c.t < duree) return c.val
  const r = await gh(['pr', 'view', '--json', 'number,title,state,reviewDecision,statusCheckRollup,url,headRefName,baseRefName'], chemin)
  let val = null
  if (r.ok) {
    try {
      const j = JSON.parse(String(r.out))
      const rollup = Array.isArray(j.statusCheckRollup) ? j.statusCheckRollup : []
      const etats = rollup.map((c2) => String(c2.conclusion || c2.status || 'PENDING').toUpperCase())
      const valChecks = etats.length === 0
        ? 'none'
        : etats.some((x) => x === 'FAILURE' || x === 'TIMED_OUT' || x === 'CANCELLED') ? 'fail'
          : etats.every((x) => x === 'SUCCESS' || x === 'SKIPPED') ? 'pass' : 'running'
      val = {
        numero: j.number,
        titre: j.title,
        etat: String(j.state || '').toLowerCase(), // open | merged | closed
        revue: String(j.reviewDecision || '').toLowerCase(), // approved | changes_requested | review_required
        checks: valChecks,
        url: j.url,
        branche: j.headRefName,
        cible: j.baseRefName
      }
    } catch (e) { val = null }
  }
  cache.set(chemin, { t: horloge(), val })
  return val
}

export async function prCreer ({ chemin, exec = false, run = gitRun, gh = ghRun }) {
  if (!chemin || !existsSync(chemin)) return gitFail('folder-not-found')
  const g = await etatGit(chemin, run)
  if (!g.git) return gitFail('not-a-repo')
  if (g.branche === g.base) return gitFail('current-is-base')
  if (!g.distant || !/github\.com/.test(g.distant)) return gitFail('no-github-remote')
  if (g.nonFusionnes <= 0 && g.modifications <= 0) return gitFail('nothing-to-review', { base: g.base })
  const commandes = ['git push', 'gh pr create --fill']
  if (!exec) return { ok: true, dry: true, commandes, branche: g.branche, cible: g.base }
  const p = await run(['push'], chemin)
  if (!p.ok) return gitFail('push-refused', { detail: said(p) })
  const c = await gh(['pr', 'create', '--fill'], chemin)
  if (!c.ok) return gitFail('gh-pr-create-refused', { detail: said(c) })
  // gh prints the address of the new request on its last line: it is the `message` (as before) and rides along as `url`.
  const last = String(c.out || '').trim().split('\n').filter(Boolean).pop()
  return { ok: true, code: 'pr-opened', message: last || gitText('pr-opened'), ...(last !== undefined && /^https?:\/\//.test(last) ? { url: last } : {}) }
}

export async function prFusionner ({ chemin, exec = false, gh = ghRun }) {
  if (!chemin || !existsSync(chemin)) return gitFail('folder-not-found')
  const commandes = ['gh pr merge --merge']
  if (!exec) return { ok: true, dry: true, commandes }
  const c = await gh(['pr', 'merge', '--merge'], chemin)
  if (!c.ok) return gitFail('gh-pr-merge-refused', { detail: said(c) })
  return gitDone('pr-merged')
}

// ── mounting of the routes (webServer) ──────────────────────────────────────

const envoyer = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

// Same-origin guard. DSH serves plugin routes BEFORE its own authentication (measured on
// 0.2.0-rc.2: `/` answers 401 without a cookie, `/kybernos-sessions/settings` answers 200), so
// each plugin guards itself. The origin is compared with the REAL listening address of the
// socket, never with the client-supplied Host header, and never by prefix
// (« localhost.evil.example » used to pass: recette 2026-10, M-02/S-03).
// A request that changes state (anything but GET, HEAD, OPTIONS) MUST carry an Origin, or
// failing that a Referer: a browser always sends an Origin on a POST, so its absence means a
// caller that is not a browser. Reads tolerate its absence (direct navigation) but still
// refuse a foreign origin, which DNS rebinding always sends. Same rule as `sameOriginStrict`
// and `sameOriginLax` in the core bundle.
const METHODES_LECTURE = ['GET', 'HEAD', 'OPTIONS']
export const origineOK = (req) => {
  const headers = (req !== null && req !== undefined && req.headers !== null && req.headers !== undefined) ? req.headers : {}
  const lecture = METHODES_LECTURE.indexOf(String((req && req.method) || 'GET').toUpperCase()) !== -1
  const o = String(headers.origin || headers.referer || '')
  if (o === '') return lecture
  try {
    const u = new URL(o)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const port = (req.socket && typeof req.socket.localPort === 'number') ? ':' + req.socket.localPort : ''
    return (['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host))
  } catch { return false }
}

// A POST of this bundle runs git or gh in the person's folders (isolate, commit, close, reclaim, push, fetch, sync, pr), writes the files the agents read (settings, the category registry) or
// spends the Study model (brain/health, decision), so on top of the Origin above it needs DSH's signed browser session (session-guard.mjs, kybernos-terminal's rule, L3-18): an Origin
// header is forgeable by any local program, and before this `curl -X POST -H 'Origin: http://127.0.0.1:<port>' .../kybernos-sessions/push -d '{"exec":true}'` published the commits that
// had not been reviewed and `pr` with `action: 'merge'` merged the pull request. The callers are pages (the Changes panel, the sessions list, Settings) and scripts/dsh-relance.mjs, which
// signs its own cookie; a paired phone is refused (`refused_on_phone`). Answers the refusal and returns true when the request must stop there.
const refuserSansSession = (req, res) => {
  const refus = writeGuard(req)
  if (refus === null) return false
  envoyer(res, refus.status, { ok: false, error: refus.error })
  return true
}

// The body of a POST, counted as it arrives: the rule of `readBody(req, cap)` in kybernos-search/guard.mjs (bundles read on their own, so the small
// function is copied, not imported), over events because the tests of this bundle drive the routes with a request stand-in that has `on()` only.
// Past `cap` bytes nothing more is kept, the caller gets 413 with `Connection: close` and the request is destroyed once the answer is out; the
// promise then resolves `null` and the route stops (the answer is already sent). Before, the body was added to a string without any limit: 150 MB
// from a program that only forged an Origin cost +390 MB of memory and a 400 after the whole body was read, and a body past 512 MB would have thrown
// `RangeError: Invalid string length` inside the 'data' listener and ended DSH (recette L3-43). A request that ends badly (aborted, reset) resolves
// `null` too: nobody is left to answer.
// 256 KiB for every POST of this bundle: the honest bodies are a few lines (a session id, a folder, a commit message, at most 50 file paths, a list of
// configured models for the health probe, the `kybers` of a decision).
const CORPS_MAX = 256 * 1024
const lireCorps = (req, res, cap = CORPS_MAX) => new Promise((resoudre) => {
  const morceaux = []
  let taille = 0
  let fini = false
  const finir = (valeur) => { if (fini) return; fini = true; morceaux.length = 0; resoudre(valeur) }
  req.on('data', (d) => {
    if (fini) return
    const octets = typeof d === 'string' ? Buffer.from(d) : d
    taille += octets.length
    if (taille > cap) {
      try { res.setHeader?.('Connection', 'close') } catch (e) { /* a stand-in */ }
      try { res.once?.('finish', () => req.destroy?.()) } catch (e) { /* a stand-in */ }
      envoyer(res, 413, { ok: false, code: 'corps-trop-gros', erreur: 'request body too large (' + Math.round(cap / 1024) + ' KiB at most)' })
      finir(null)
      return
    }
    morceaux.push(octets)
  })
  req.on('end', () => {
    if (fini) return
    const brut = morceaux.length === 0 ? '' : Buffer.concat(morceaux).toString('utf8')
    // `null` is the "already answered" signal of this function, so a body that is the JSON text `null` reads as an empty one.
    try { finir(JSON.parse(brut || '{}') ?? {}) } catch (e) { finir({}) }
  })
  req.on('error', () => finir(null))
  req.on('close', () => finir(null))
})

// ── S-01: confinement of free paths ─────────────────────────────────────────
// A `chemin` supplied by the client is only accepted if the sessions KNOW it (a
// slug of that path exists under sessionsHome: a session really worked there).
// The slug derived from `corps.session` always stays valid. Any other path
// (e.g. /tmp, /etc) is refused before it reaches git/gh — execution stays
// confined to the roots of the registered work.
const cheminConfine = (sessionsHome, corps, slug) => {
  if (corps.chemin === undefined || corps.chemin === null || corps.chemin === '') {
    return slug !== null ? decodeSlugPath(slug) : null
  }
  const libre = String(corps.chemin)
  if (slugsDeChemin(sessionsHome, libre).length === 0) return null
  return libre
}

// ── model health: what the « Study model » watches ──────────────────────────
// The probe lives in its own module (brain-health.mjs): it is tested outside
// DSH with a fake `llm` service, with no network and no key.
export function monterRoutes (webServerSvc, opts) {
  webServerSvc = kbFenced(webServerSvc)
  // What `register` hands back is the way to take the route off again. The host calls it when the plugin unloads (apply() gives this function to
  // `ctx.effect`): without it a bundle that was switched off kept serving routes that run git and rm, and a reload met « duplicate exact route ».
  const retraits = []
  const bruts = webServerSvc
  webServerSvc = new Proxy(bruts, { get: (target, key) => (key === 'register'
    ? (route) => { const retrait = target.register(route); if (typeof retrait === 'function') retraits.push(retrait); return retrait }
    : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) })
  const sessionsHome = opts.sessionsHome
  const kybersHome = opts.kybersHome
  // Settings, category registry and credentials. Given by `apply()` (the real DSH
  // home); otherwise derived from the session store, so a harness that passes a
  // temporary home stays out of the real one. With no session store either, the
  // DSH home itself (never <os home>/kybernos, which is not a DSH folder).
  const base = sessionsHome === undefined ? dshHome() : dirname(sessionsHome)
  const reglagesFichier = opts.reglagesPath || join(base, 'kybernos', 'settings.json')
  const categoriesFichier = opts.categoriesPath || join(base, 'kybernos', 'categories.json')
  // The `llm` service is read AT CALL TIME, not at mount: DSH may publish it after this plugin, and a plugin that refuses to
  // mount would lose all its routes. A getter and not a function: `creerSonde` tests `typeof llm.stream` to say « service
  // unavailable » instead of accusing the 56 models. The health probe and the closed questions both go through it.
  const llmParesseux = {
    get stream () {
      let svc = null
      try { svc = opts.ctx === undefined || opts.ctx === null ? null : opts.ctx.get('llm') } catch (e) { svc = null }
      return svc === null || svc === undefined || typeof svc.stream !== 'function' ? undefined : svc.stream.bind(svc)
    }
  }
  const sondeSante = creerSonde({
    llm: llmParesseux,
    delaiMs: parseInt(process.env.KB_BRAIN_DELAI || '8000', 10),
    concurrence: parseInt(process.env.KB_BRAIN_CONCURRENCE || '4', 10),
    ttlMs: parseInt(process.env.KB_BRAIN_TTL || '18000000', 10)
  })
  // The banner polls: the traffic verdict is read from the journal at most once per half minute.
  const TRAFIC_TTL_MS = 30_000
  let traficCache = null
  // ── the Study model in force ──────────────────────────────────────────────
  // `brain` is the person's choice: a `route/id`, `none` (no Study model) or empty (Automatic: etude-auto.mjs picks the model
  // from what is connected). The automatic choice is cached a minute (ten seconds while nothing was found, so a model that
  // gets connected is taken up quickly) and read from the host's `settings` and `credentials` services at call time.
  const maintenantMs = () => (typeof opts.maintenant === 'function' ? Number(opts.maintenant()) : Date.now())
  const service = (nom) => {
    if (opts.ctx === undefined || opts.ctx === null) return undefined
    try { const svc = opts.ctx.get(nom); if (svc !== undefined && svc !== null) return svc } catch (e) { /* read from the root below */ }
    // Cordis lets a plugin read, with `get`, only the services it declared; the root context holds them all (read-only here).
    try { const svc = opts.ctx.root[nom]; return svc === null ? undefined : svc } catch (e) { return undefined }
  }
  const AUCUN_AUTO = { cle: '', raison: null }
  let auto = { ...AUCUN_AUTO, a: -Infinity }
  let autoEnCours = null
  const autoPerime = () => maintenantMs() - auto.a >= (auto.cle === '' ? 10000 : 60000)
  const rafraichirAuto = () => {
    if (autoEnCours !== null) return autoEnCours
    autoEnCours = (async () => {
      const modeles = await modelesConnectes({ settings: service('settings'), credentials: service('credentials') })
      return choisirEtudeAuto({ modeles, ecartes: ecartesDe(sondeSante.dernier()) })
    })().then((r) => { auto = { ...(r === null ? AUCUN_AUTO : r), a: maintenantMs() } }, () => { auto = { ...AUCUN_AUTO, a: maintenantMs() } })
      .then(() => { autoEnCours = null })
    return autoEnCours
  }
  const etudeAuto = async () => { if (autoPerime()) await rafraichirAuto(); return auto }
  // For the callers that cannot wait (the Memory tidy-up reads it synchronously): the last automatic choice, and a refresh
  // started in the background when it is stale. Published below for the other bundles, which cannot import this one.
  const etudeAutoSync = () => { if (autoPerime()) rafraichirAuto(); return auto.cle }
  /** `{ actif, cle, mode, raison }`: `mode` is `choisi` (the person's pick), `auto`, `none` (the person chose none) or `aucun`
   *  (Automatic, but nothing connected qualifies). Never throws. */
  const etudeEnVigueur = async () => {
    try {
      const brain = lireReglages(reglagesFichier).brain
      if (brain === 'none') return { actif: false, cle: '', mode: 'none', raison: null }
      if (brain !== '') return { actif: true, cle: brain, mode: 'choisi', raison: null }
      const a = await etudeAuto()
      return a.cle === '' ? { actif: false, cle: '', mode: 'aucun', raison: null } : { actif: true, cle: a.cle, mode: 'auto', raison: a.raison }
    } catch (e) { return { actif: false, cle: '', mode: 'aucun', raison: null } }
  }
  if (opts.ctx !== undefined && opts.ctx !== null) {
    // The contract with the bundles that cannot import this one (Memory's tidy-up): a function giving the AUTOMATIC Study
    // model, « route/id » or '' (same pattern as `kybernos.trustedAuthority`, published by the core bundle). Absent, they
    // behave as before: no Study model unless the person chose one.
    try { globalThis[Symbol.for('kybernos.studyModel')] = etudeAutoSync } catch (e) { /* the bundle works without it */ }
    rafraichirAuto()
  }

  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/state', handler: async (req, res) => {
    if (req.method !== 'GET') { res.writeHead(405); res.end('GET only'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    try {
      const u = new URL(req.url, 'http://127.0.0.1')
      const sessionId = u.searchParams.get('session') || ''
      const fenetreH = parseInt(u.searchParams.get('window') || '24', 10)
      const etat = await construireEtat({
        sessionsHome, kybersHome, sessionId,
        fenetreMs: (Number.isFinite(fenetreH) ? fenetreH : 24) * 3600 * 1000,
        avecPr: true
      })
      envoyer(res, 200, etat)
    } catch (e) {
      envoyer(res, 500, { erreur: String(e && e.message ? e.message : e) })
    }
  } })
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/isolate', handler: async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST only'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    if (refuserSansSession(req, res)) return
    const corps = await lireCorps(req, res)
    if (corps === null) return
    const slug = dossierDeSession(sessionsHome, corps.session || '')
    const chemin = slug !== null ? decodeSlugPath(slug) : null
    envoyer(res, 200, await isoler({ chemin, nom: corps.nom, but: corps.but, exec: corps.exec === true, sessionsHome }))
  } })
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/commit', handler: async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST only'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    if (refuserSansSession(req, res)) return
    const corps = await lireCorps(req, res)
    if (corps === null) return
    const slug = dossierDeSession(sessionsHome, corps.session || '')
    const chemin = cheminConfine(sessionsHome, corps, slug)
    envoyer(res, 200, await commiter({ chemin, message: corps.message, exec: corps.exec === true, chemins: Array.isArray(corps.chemins) ? corps.chemins : null, pousser: veutPousser(corps) }))
  } })
  // ── « commit & merge into the local repo »: no remote write ────────────────
  // The same route as /commit with `local:true` (pousser:false): add only this
  // chat's files, commit, then merge into the local base branch. A clean tree
  // plus unmerged commits stays a useful case (merge alone) — see `commiter`.
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/close-check', handler: async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST only'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    if (refuserSansSession(req, res)) return
    const corps = await lireCorps(req, res)
    if (corps === null) return
    const slug = dossierDeSession(sessionsHome, corps.session || '')
    const chemin = cheminConfine(sessionsHome, corps, slug)
    try {
      envoyer(res, 200, await sondeCloture({ chemin, forceIgnores: corps.forceIgnores === true }))
    } catch (e) {
      envoyer(res, 500, { ok: false, cloturable: false, erreur: String(e && e.message ? e.message : e) })
    }
  } })
  // ── model health (the « Study model ») ────────────────────────────────────
  // The client sends the list of configured models — only it knows it, it comes
  // from the settings service. The host probes each one with a tiny REAL call.
  // Study model on None (or Automatic with nothing connected): nobody watches, nothing is probed, and the answer says so.
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/brain/health', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    // GET: the last reading, without relaunching anything — this is what the banner
    // reads at load, so as not to probe again every time a chat opens.
    if (req.method === 'GET') {
      // The banner also gets what real traffic says: a model that answered is alive, for free. Cached 30 s so a
      // polling tab does not re-read the journal; the probe's last reading stays as it was.
      let trafic = traficCache !== null && (Date.now() - traficCache.quand) < TRAFIC_TTL_MS ? traficCache.valeur : null
      if (trafic === null) {
        trafic = trafficHealth(readTrafficFile(join(base, 'kybernos', 'log', 'events.jsonl'), { readFile: (f) => readFileSync(f, 'utf8') }))
        traficCache = { valeur: trafic, quand: Date.now() }
      }
      envoyer(res, 200, { ok: true, dernier: sondeSante.dernier(), trafic })
      return
    }
    if (req.method !== 'POST') { res.writeHead(405); res.end('GET or POST only'); return }
    if (refuserSansSession(req, res)) return
    const corps = await lireCorps(req, res)
    if (corps === null) return
    try {
      const etude = await etudeEnVigueur()
      // Automatic watches what the person connected; a model they picked as Study model watches every model they listed.
      const brut = etude.mode === 'auto'
        ? garderConnectes(corps.models, await modelesConnectes({ settings: service('settings'), credentials: service('credentials') }))
        : corps.models
      // Our own gateway is never pinged: it meters and bills what it receives (measured 2026-10-28). Operators can
      // add providers with KB_NO_PROBE_PROVIDERS.
      const { probe: aSonder, skipped } = filterProbeable(brut, excludedFrom(process.env))
      if (aSonder.length === 0) {
        envoyer(res, 200, { ok: true, actif: true, brain: etude.cle, total: 0, sains: 0, alertes: [], ecartes: skipped, raison: 'tous-ecartes' })
        return
      }
      envoyer(res, 200, { ...(await sondeSante.sonder(aSonder, { brain: etude.cle, force: corps.force === true })), ecartes: skipped })
    } catch (e) {
      envoyer(res, 500, { ok: false, erreur: String(e && e.message ? e.message : e) })
    }
  } })
  // ── closed questions: where the job is to SORT, not to write ───────────────
  // Two forms, one route:
  //   { categorie: "chat title" }                → which category (so which icon) the chat gets;
  //   { kybers: [{id, mission}], demande }       → which agent team handles the request.
  // A category goes to the word rules of classement-local.mjs FIRST (free, instant, nothing leaves the machine) and to the
  // Study model only when they say nothing. The model's answer is kept only if it is an id of the list (decision-llm.mjs).
  // The verdict is answered with a 200 even when negative: like the health probe, this route gives a VERDICT, it does not
  // throw — the caller reads `ok`, and `ok:false` is not a failure of the route.
  const DUREE_REPOS_ETUDE = 5 * 60 * 1000 // after a failure the model is not asked again for 5 minutes (a list asks for a dozen rows at once)
  const DUREE_DOUTE = 30 * 60 * 1000 // an answer « not sure » is not asked again for half an hour
  const TITRES_MEMOIRE_MAX = 300
  const delaiDecision = parseInt(process.env.KB_DECISION_DELAI || '', 10)
  const optionsDecision = (modele) => ({ llm: llmParesseux, modele, ...(delaiDecision > 0 ? { delaiMs: delaiDecision } : {}) })
  const SANS_ETUDE = { ok: false, code: 'ETUDE-ABSENTE', erreur: 'no Study model: the closed question is not put to any model', ms: 0 }
  let etudeAuRepos = null // { jusqua, verdict }: the last failure of the Study model for a category, and until when it rests
  const titresJuges = new Map() // normalised title → { reponse, jusqua }
  const cleTitre = (titre) => titre.toLowerCase().replace(/\s+/g, ' ').trim()
  const memoriser = (cle, reponse, jusqua) => {
    if (titresJuges.size >= TITRES_MEMOIRE_MAX) titresJuges.delete(titresJuges.keys().next().value)
    titresJuges.set(cle, { reponse, jusqua })
  }
  // Failures that say nothing about the model (a missing text, a service not mounted yet) do not put it to rest.
  const PAS_UNE_PANNE = ['SANS-TEXTE', 'SANS-CATEGORIE', 'LLM-INDISPONIBLE', 'ETUDE-ABSENTE']
  const trancherCategorie = async (titre, maintenant) => {
    if (estTitreAttente(titre)) return { ok: false, code: 'SANS-TEXTE', erreur: 'a placeholder title says nothing about the chat', ms: 0 }
    const local = classerLocalement(titre)
    if (local.categorie !== null) {
      return { ok: true, motif: 'local', categorie: local.categorie, source: 'local', score: local.score, ecart: local.ecart, mots: local.mots, ms: 0 }
    }
    const etude = await etudeEnVigueur()
    if (etude.actif !== true) return SANS_ETUDE
    const cle = cleTitre(titre)
    const connu = titresJuges.get(cle)
    if (connu !== undefined && maintenant < connu.jusqua) return connu.reponse
    if (etudeAuRepos !== null && maintenant < etudeAuRepos.jusqua) return etudeAuRepos.verdict
    const verdict = await selectionnerCategorie(titre, optionsDecision(etude.cle))
    if (verdict.ok === true) {
      etudeAuRepos = null
      memoriser(cle, verdict, verdict.categorie === null ? maintenant + DUREE_DOUTE : Infinity)
    } else if (PAS_UNE_PANNE.indexOf(verdict.code) < 0) {
      etudeAuRepos = { jusqua: maintenant + DUREE_REPOS_ETUDE, verdict }
    }
    return verdict
  }
  const trancherKyber = async (corps) => {
    const etude = await etudeEnVigueur()
    if (etude.actif !== true) return SANS_ETUDE
    return selectionnerKyber(corps.kybers, corps.demande, optionsDecision(etude.cle))
  }
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/decision', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST only'); return }
    if (refuserSansSession(req, res)) return
    const corps = await lireCorps(req, res)
    if (corps === null) return
    try {
      let reponse
      if (corps.questions !== null && corps.questions !== undefined && typeof corps.questions === 'object' && Array.isArray(corps.questions) === false) {
        // The free typed question belonged to the old gateway evaluation API, which this route no longer calls.
        reponse = { ok: false, code: 'QUESTION-NON-SUPPORTEE', erreur: 'typed questions are gone: send { categorie } or { kybers, demande }', ms: 0 }
      } else if (corps.categorie !== undefined && corps.categorie !== null) {
        reponse = await trancherCategorie(String(corps.categorie), maintenantMs())
      } else {
        reponse = await trancherKyber(corps)
      }
      envoyer(res, 200, reponse === null || typeof reponse !== 'object' ? { ok: false, code: 'VERDICT-ILLISIBLE', erreur: 'the engine returned nothing' } : reponse)
    } catch (e) {
      envoyer(res, 200, { ok: false, code: 'MOTEUR-EN-PANNE', erreur: String(e && e.message ? e.message : e) })
    }
  } })
  // ── Kybernos settings: what the Settings page reads and writes ──────────────
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/settings', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    if (req.method === 'GET') {
      // `auto`: the model Automatic uses (or ''), always, so the select can name it whatever is in force.
      const etude = await etudeEnVigueur()
      envoyer(res, 200, { ok: true, reglages: lireReglages(reglagesFichier), etude: { ...etude, auto: (await etudeAuto()).cle } })
      return
    }
    if (req.method !== 'POST') { res.writeHead(405); res.end('GET or POST only'); return }
    if (refuserSansSession(req, res)) return
    try {
      const corps = await lireCorps(req, res)
      if (corps === null) return
      const r = ecrireReglages(reglagesFichier, corps)
      envoyer(res, r.ok === false ? (r.invalide === true ? 400 : 500) : 200, r.ok === false ? { ok: false, code: r.code, erreur: r.erreur } : { ok: true, reglages: r.reglages })
    } catch (e) {
      envoyer(res, 500, { ok: false, erreur: String(e && e.message ? e.message : e) })
    }
  } })
  // ── session categories: the list draws them as SVG (no more emoji) ──────────
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/categories', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    if (req.method === 'GET') {
      try {
        envoyer(res, 200, { ok: true, categories: lireCategories(categoriesFichier), connues: CATEGORIES_CONNUES })
      } catch (e) {
        envoyer(res, 500, { ok: false, erreur: String(e && e.message ? e.message : e) })
      }
      return
    }
    if (req.method !== 'POST') { res.writeHead(405); res.end('GET or POST only'); return }
    if (refuserSansSession(req, res)) return
    // The ONLY writer of the registry: the naming CLI AND the client's automatic
    // classification come through here — one format, one validator. `auto:true`
    // marks the category set without an agent naming (replaceable, re-classifiable).
    const corps = await lireCorps(req, res)
    if (corps === null) return
    const r = ecrireCategorie(categoriesFichier, String(corps.session || ''), String(corps.cat || ''), String(corps.titre || ''), corps.auto === true)
    envoyer(res, r.ok === true ? 200 : 400, r)
  } })
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/close', handler: async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST only'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    if (refuserSansSession(req, res)) return
    const corps = await lireCorps(req, res)
    if (corps === null) return
    const slugC = dossierDeSession(sessionsHome, corps.session || '')
    envoyer(res, 200, await cloturer({ chemin: cheminConfine(sessionsHome, corps, slugC), exec: corps.exec === true, forceIgnores: corps.forceIgnores === true }))
  } })
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/reclaim', handler: async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST only'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    if (refuserSansSession(req, res)) return
    const corps = await lireCorps(req, res)
    if (corps === null) return
    const slug = dossierDeSession(sessionsHome, corps.session || '')
    const chemin = cheminConfine(sessionsHome, corps, slug)
    envoyer(res, 200, await ramasser({ chemin, exec: corps.exec === true, sessionsHome, forceIgnores: corps.forceIgnores === true }))
  } })
  // ── v3 « status light »: GitHub sync + pull requests (dry run first) ────────
  const routeAction = (path, faire, extra = () => ({})) => webServerSvc.register({ kind: 'exact', path, handler: async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST only'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    if (refuserSansSession(req, res)) return
    const corps = await lireCorps(req, res)
    if (corps === null) return
    const slug = dossierDeSession(sessionsHome, corps.session || '')
    const chemin = cheminConfine(sessionsHome, corps, slug)
    envoyer(res, 200, await faire({ chemin, ...extra(corps), exec: corps.exec === true }))
  } })
  routeAction('/kybernos-sessions/push', (o) => pousser(o))
  routeAction('/kybernos-sessions/fetch', (o) => rapatrier(o))
  routeAction('/kybernos-sessions/sync', (o) => synchroniser(o))
  routeAction('/kybernos-sessions/pr', (o) => (o.action === 'merge' ? prFusionner(o) : prCreer(o)),
    (corps) => ({ action: corps.action }))
  return () => { for (const retrait of retraits.splice(0).reverse()) { try { retrait() } catch (e) { /* already gone */ } } }
}

export function apply (ctx) {
  try {
    const home = dshHome()
    const demarrer = (hostCtx) => {
      // `get`, not `hostCtx.webServer`: with the plugin's own context a property read of a service it did not inject throws.
      const monter = () => monterRoutes(hostCtx.get('webServer'), {
        ctx: hostCtx,
        sessionsHome: join(home, 'sessions'),
        kybersHome: join(home, 'kybers'),
        reglagesPath: join(home, 'kybernos', 'settings.json'),
        categoriesPath: join(home, 'kybernos', 'categories.json')
      })
      if (typeof hostCtx.effect === 'function') hostCtx.effect(monter, 'kybernos-sessions: routes')
      else monter()
      console.log('[kybernos-sessions] webServer routes /kybernos-sessions/* registered (state, settings, categories, actions)')
    }
    if (ctx.get('webServer') !== undefined) demarrer(ctx)
    else ctx.inject(['webServer'], demarrer)
  } catch (e) {
    console.error('[kybernos-sessions] cannot start', e)
  }
}
