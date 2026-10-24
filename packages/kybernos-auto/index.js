// ═══════════════════════════════════════════════════════════════════════════
// kybernos-auto — host half.
//
// Auto mode, in ONE dedicated bundle (02/10/2026, user decision):
//   • state PER SESSION   → <DSH home>/kybernos/auto-sessions.json  (~/.dsh by default)
//   • whitelist/classifier (global) → <DSH home>/kybernos/settings.json
//     (the same keys as the first iteration: autoRouting* stay readable there,
//     the bundle's own Settings page now writes them)
//   • health per model    → <DSH home>/kybernos/auto-health.json (local counters
//     written at each routing: calls, errors, last latency)
//   • the router itself (rules → optional local classifier, empty by default → whitelist)
//
// The router is a faithful COPY of the CLI `~/.dsh/tools/auto-router.mjs`
// (same contract, same classes chat|code|vision|media|agent-task). The CLI
// stays standalone for the agent; the host serves the page and the composer's chip.
// ═══════════════════════════════════════════════════════════════════════════

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, realpathSync, renameSync, chmodSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { DELAI_DEFAUT, normaliserListe, sonderUn } from './sonde.mjs'
import { TTL_SONDE_MS, apresIssue, issueDeRapport, plafondEssais, resoudre, triCandidats, vueModele } from './resilience.mjs'
import { createFailover } from './failover.mjs'
import { SCOPES, etendre, modelesConnus, refuserListe, scopeEnVigueur } from './modeles.mjs'
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
// What `register` hands back takes the route off again. It is kept here and given to `ctx.effect` by `apply`, so that unloading the plugin removes every route it
// added: without it a hot reload met « duplicate exact route », logged « routes not mounted » and went on serving the OLD handlers (audit L4-05, L6-04).
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

/** A route that WRITES (the switches, the whitelist, a probe that spends tokens) needs DSH's signed session as well as the right Origin (session-guard.mjs,
 *  the terminal's rule): plugin routes are served before DSH's own login and an Origin header is forgeable by any local program. Sends the refusal. */
const ecritureAutorisee = (req, res) => {
  const refus = writeGuard(req)
  if (refus === null) return true
  res.writeHead(refus.status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ ok: false, error: refus.error }))
  return false
}

export const name = 'kybernos-auto'

/**
 * The DSH home, resolved the way DSH does (@deepseek-ai/dsh-home-paths): a non-blank $DSH_HOME
 * (trimmed, a leading ~ expanded), else <os home>/.dsh. Resolved at each use, never cached.
 * DSH_HOME IS the DSH folder: the default used to be join(DSH_HOME || homedir(), '.dsh'), which
 * is $DSH_HOME/.dsh (a second, empty folder) as soon as DSH_HOME is set.
 */
export const dshHome = (env = process.env, osHome = homedir) => {
  const raw = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (raw === '') return join(osHome(), '.dsh')
  if (raw === '~') return osHome()
  return resolve(raw.startsWith('~/') || raw.startsWith('~\\') ? join(osHome(), raw.slice(2)) : raw)
}

const OLLAMA = process.env.AUTO_ROUTER_OLLAMA || 'http://127.0.0.1:11434'
const CLASSES = ['chat', 'code', 'vision', 'media', 'agent-task']
/** The most models « Check now » asks in one run (each is a real, tiny call). */
export const SONDE_MAX = 20

// ── settings.json is SHARED (the core reads pairingToken, gatewayBase, wsAdminKey; the
// sessions bundle writes its own keys): a save merges, never replaces, is atomic, and
// never overwrites a file it cannot read as a JSON object. ───────────────────────────
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

// ── settings (the models Auto may use + classifier): same keys as settings.json ───────
export function lireReglagesAuto (fichier) {
  let brut = {}
  try { brut = JSON.parse(readFileSync(fichier, 'utf8')) } catch { brut = {} }
  const whitelistValide = Array.isArray(brut.autoWhitelist) &&
    brut.autoWhitelist.length <= 64 &&
    brut.autoWhitelist.every((x) => typeof x === 'string' && x.length <= 200) &&
    new Set(brut.autoWhitelist).size === brut.autoWhitelist.length
  const liste = whitelistValide === true ? brut.autoWhitelist : []
  return {
    whitelist: liste,
    // Which models Auto may pick from: every connected one (the default), only the free ones, or the typed list above. A list
    // saved before scopes existed stays the list (modeles.mjs scopeEnVigueur).
    scope: scopeEnVigueur(brut.autoScope, liste),
    classifier: typeof brut.autoClassifier === 'string' ? brut.autoClassifier : '',
    global: brut.autoRouting === true,
    // Opt-in: the chat itself moves to the next whitelist model when its own cannot answer (failover.mjs).
    failover: brut.autoFailover === true
  }
}

// ── the models Auto may pick from (the scope resolved against what the host knows) ─────────────────────────────────────
/** The configured models, read through `modeles()` (the host's settings and credentials services) and kept `ttlMs`: Auto asks for the
 *  list on every request, the services are asked once in a while. Never throws; `lire()` answers null when nothing is known. */
export function creerUnivers ({ modeles, horloge = () => Date.now(), ttlMs = 15000 } = {}) {
  let derniere = null
  let enCours = null
  const lire = () => {
    if (typeof modeles !== 'function') return Promise.resolve(null)
    if (derniere !== null && horloge() - derniere.at < ttlMs) return Promise.resolve(derniere.liste)
    if (enCours === null) {
      enCours = Promise.resolve().then(() => modeles())
        .then((l) => { derniere = { at: horloge(), liste: Array.isArray(l) ? l : null } }, () => { derniere = { at: horloge(), liste: null } })
        .then(() => { enCours = null })
    }
    return enCours.then(() => (derniere === null ? null : derniere.liste))
  }
  return { lire, cache: () => (derniere === null ? null : derniere.liste), oublier: () => { derniere = null } }
}
/** The list Auto routes among right now: the typed one, or the connected (free) models. */
export const listeEffective = async (reg, univers) => etendre(reg.scope, reg.whitelist, reg.scope === 'custom' ? null : await univers.lire())
/** The same from what was last read, for the callers that cannot wait (the chat failover). */
export const listeEffectiveCache = (reg, univers) => etendre(reg.scope, reg.whitelist, reg.scope === 'custom' ? null : univers.cache())
/** The models the host's services can name, for the host to build with `modelesConnus` at call time. */
const modelesDeLHote = (ctx) => async () => {
  const service = (nom) => {
    try { const svc = ctx.get(nom); if (svc !== undefined && svc !== null) return svc } catch (e) { /* read from the root below */ }
    try { const svc = ctx.root[nom]; return svc === null ? undefined : svc } catch (e) { return undefined }
  }
  return modelesConnus({ settings: service('settings'), credentials: service('credentials') })
}

// ── PER-SESSION state ──────────────────────────────────────────────────
export function lireSessions (fichier) {
  let brut = {}
  try { brut = JSON.parse(readFileSync(fichier, 'utf8')) } catch { brut = {} }
  return (brut !== null && typeof brut === 'object' && !Array.isArray(brut)) ? brut : {}
}

export function ecrireSession (fichier, sessionId, on) {
  const id = String(sessionId || '').trim()
  if (id === '' || id.length > 200) return { ok: false, erreur: 'sessionId expected' }
  const sessions = lireSessions(fichier)
  if (on === true) sessions[id] = true
  else delete sessions[id]
  try {
    mkdirSync(dirname(fichier), { recursive: true })
    writeFileSync(fichier, JSON.stringify(sessions, null, 2) + '\n')
    return { ok: true, on: on === true, sessions }
  } catch (e) {
    return { ok: false, erreur: String(e && e.message ? e.message : e) }
  }
}

// ── health: one record per model, written by probes and by the delegations' reports ───
export function lireSante (fichier) {
  let brut = {}
  try { brut = JSON.parse(readFileSync(fichier, 'utf8')) } catch { brut = {} }
  return (brut !== null && typeof brut === 'object' && !Array.isArray(brut)) ? brut : {}
}

/** Record one outcome. A probe (`rapport` false) updates the breaker and the last probe; a delegation's report
 *  (`rapport` true) also counts as a call, with its latency and cache usage. Routing itself records nothing: a model
 *  that was merely chosen has not yet done anything. */
export function noterIssue (fichier, modele, issue, { rapport = false, latenceMs = null, usage = null, maintenant = Date.now() } = {}) {
  if (typeof modele !== 'string' || modele === '' || modele.length > 200) return null
  const sante = lireSante(fichier)
  const m = apresIssue(sante[modele], issue, maintenant)
  if (rapport === true) {
    m.calls += 1
    if (issue.etat !== 'ok') m.errors += 1
    if (typeof latenceMs === 'number' && latenceMs >= 0) m.lastLatencyMs = Math.round(latenceMs)
    // cache: the report carries the input tokens and those read from the cache
    if (usage !== null && Number.isFinite(usage.inputTokens) && usage.inputTokens > 0 &&
        Number.isFinite(usage.cacheReadTokens) && usage.cacheReadTokens >= 0 && usage.cacheReadTokens <= usage.inputTokens) {
      m.cacheInput = (m.cacheInput || 0) + usage.inputTokens
      m.cacheRead = (m.cacheRead || 0) + usage.cacheReadTokens
    }
  } else {
    m.probes += 1
    m.lastProbe = { at: maintenant, etat: issue.etat, ms: Number.isFinite(issue.ms) ? Math.round(issue.ms) : null, code: String(issue.code || '') }
  }
  sante[modele] = m
  try {
    writeFileAtomically(fichier, JSON.stringify(sante, null, 2) + '\n')
  } catch { /* a lost counter never breaks a routing */ }
  return m
}

/** The page's view: for each whitelist model, its record and what the breaker says now. */
export function vueSante (sante, whitelist, maintenant = Date.now()) {
  return whitelist.map((modele) => vueModele(modele, sante[modele], maintenant))
}

// ── the router: rules → local classifier → whitelist → probe-first chain ──────────────
// Same classes and rules as the CLI `~/.dsh/tools/auto-router.mjs` (the agent's reflex before a delegation), which asks
// this host first and keeps its own copy only as a fallback when the host does not answer.
// The request is read in lower case and without accents ("génère", "genere" and "GÉNÈRE" are one word), in French and in
// English. The first rule used to be `vi[ée]deo`, which matches neither "vidéo" nor "video", and the others needed the accents or French words,
// so "generate a video of a cat", "draw an image of a lighthouse" or "write a python function" all fell through to chat.
// Order: the words that only mean media, then what is looked at, then design, then code, and only then a request to MAKE an
// image, so "a python function that generates an image" stays code.
const normaliser = (t) => String(t === undefined || t === null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘]/g, "'").toLowerCase()
const REGLES = [
  ['media', /\b(videos?|tts|text.?to.?speech|speech.?to.?text|voix de synth|voice.?over|doublag|dubbing|sous.?titr|subtitl)/],
  ['vision', /\b(regarde[rsz]?|decris|decrire|analyse[rz]?|inspecte[rz]?|lis|lire|look at|describe|analy[sz]e|inspect|read|check)\s+(?:l'|la |le |les |ce |cet |cette |ces |this |these |that |the |my |ma |mon |mes )?(?:ecran|image|capture|photo|screenshot|png|jpe?g|picture)/,
    /\b(capture d'?ecran|planche contact|what(?:'s| is) (?:in|on|shown in) (?:this|the|that) (?:image|picture|photo|screenshot))/],
  // "design" class (user decision 03/10/2026): mock-ups, templates, visual consistency, UI reviews, sites. Measured
  // 03/10: without website|landing|site web the brief of the kybernos.app site was classed "code".
  ['design', /\b(design|maquette|mock.?up|wireframe|gabarit|homogeneite (visuelle|de bord|des bords)|integration (css|ui|interface)|harmonisation|revue (ui|visuelle|vision)|parite (ui|spot)|ui\b|(site|page) web|website|landing|front.?end)/],
  ['code', /\b(bug|refactor|corrige|patch|compile|tests? unitaires?|unit tests?|migration|typescript|javascript|python|rust|golang|java\b|c\+\+|sql|regex|lint|pagination|feature|composant|component|function|fonction|script|endpoint|stack.?trace|debug|deboguer|implement|fix (?:the |this |a |my )?(?:bug|error|issue|crash|test|build|lint)|ecris (?:une?|le|la) (?:fonction|classe|script|programme)|write (?:a |an |the |some )?(?:\w+ )?(?:function|class|script|program))/],
  ['media', /\b(genere[rsz]?|cree[rz]?|fais|produis|dessine[rz]?|make|create|generate|render|draw|paint|produce|illustrate)(?:[\s-]+(?:moi|me))?\s+(?:(?:une?|des|the|an?|some)\s+)?(?:\w+\s+){0,2}(?:images?|icones?|icons?|illustrations?|photos?|logos?|dessins?|pictures?|animations?|clips?)\b/]
]
const regle = (demande) => {
  const t = normaliser(demande)
  for (const [classe, ...res] of REGLES) if (res.some((re) => re.test(t))) return classe
  return null
}
// Exported for the tests: the rules without the rest of the routing.
export { regle as classerParRegles }

/** Which whitelist models may serve a class. No metadata per model: the class is read on the id. */
export function candidats (whitelist, classe) {
  const indices = {
    media: /(wan|image|video|happyhorse|tts|audio|asr)/i,
    vision: /(vision|5v|-vl|glm-5\.3-flash)/i,
    // design: Claude first (user opinion: best at design and integration), then the other text models
    design: /(claude|sonnet|anthropic)/i,
    code: /(deepseek-chat|code|devstral|qwen-coder)/i
  }
  const re = indices[classe]
  const surprise = whitelist.filter((m) => re && re.test(m))
  if (surprise.length > 0) return surprise
  if (classe === 'chat' || classe === 'agent-task' || classe === 'code' || classe === 'design') {
    // Any non-media model can serve text: a wan2.7 does not write code.
    const texte = whitelist.filter((m) => !indices.media.test(m))
    if (texte.length > 0) return texte
  }
  return []
}

export async function classifie (demande, modele, ollama = OLLAMA) {
  const reponse = await fetch(ollama + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modele.includes('/') ? modele.split('/').pop() : modele,
      stream: false, think: false, options: { temperature: 0 },
      prompt: 'Classify into exactly one class among chat|code|vision|media|agent-task. Reply with only the class.\nRequest: ' + JSON.stringify(demande.slice(0, 400))
    }),
    signal: AbortSignal.timeout(20000)
  })
  if (!reponse.ok) throw new Error('ollama ' + reponse.status)
  const j = await reponse.json()
  const brut = String(j.response || '').trim().toLowerCase()
  return CLASSES.find((cl) => brut === cl || brut.startsWith(cl)) || null
}

/** Routing: rules → classifier → whitelist, then the chain. `opts.sante` is the raw health map (the breaker's state),
 *  `opts.sonder(modele)` probes one model (absent = no probing: the chain is the eligible candidates, unverified),
 *  `opts.noter(modele, issue)` records a probe's outcome, `opts.exclure` lists models that just failed for this very
 *  delegation. Answers { actif, classe, via, modele, verifie, candidats, chaine, ecartes, sondes, sonde, plafond, raison }:
 *  `modele` is the first model to try (null = keep the session model), `candidats` the ordered fallbacks, never more
 *  than the retry cap. */
export async function router (demande, opts = {}) {
  const reg = opts.reglages || { whitelist: [], classifier: '', global: false }
  const whitelist = reg.whitelist
  if (reg.global !== true) return { actif: false, raison: 'autoRouting off' }
  if (whitelist.length === 0) return { actif: true, classe: null, modele: null, raison: 'whitelist empty' }

  let classe = regle(demande)
  let via = 'regle'
  if (classe === null && reg.classifier) {
    try {
      classe = await classifie(demande, reg.classifier, opts.ollama)
      via = 'classifieur'
    } catch (e) {
      via = 'classifier failed (' + (e && e.message ? e.message : e) + ')'
    }
  }
  if (classe === null) classe = 'chat'
  const horloge = opts.horloge || (() => Date.now())
  const plafond = opts.plafond !== undefined ? opts.plafond : plafondEssais()
  const tous = candidats(whitelist, classe)
  const tri = triCandidats(tous, opts.sante || {}, horloge(), { exclure: Array.isArray(opts.exclure) ? opts.exclure : [], max: plafond })
  let chaine = []
  let echecs = []
  let sondes = 0
  let delai = false
  let sonde = 'indisponible'
  if (typeof opts.sonder === 'function') {
    const r = await resoudre({ eligibles: tri.eligibles, sonder: opts.sonder, cache: opts.cache || new Map(), noter: opts.noter || (() => {}), horloge, delaiMs: opts.delaiMs })
    chaine = r.chaine
    echecs = r.echecs
    sondes = r.sondes
    delai = r.delai
    sonde = r.sondes > 0 ? 'fraiche' : (chaine.some((c) => c.verifie === true) ? 'cache' : 'aucune')
  } else {
    chaine = tri.eligibles.map((modele) => ({ modele, verifie: false, source: 'unprobed' }))
  }
  const tete = chaine.length > 0 ? chaine[0] : null
  const ecartes = tri.ecartes.concat(echecs)
  let raison
  if (tete !== null && tete.verifie === true) raison = 'class ' + classe + ' → ' + tete.modele + ' answered a probe' + (ecartes.length > 0 ? ' (' + ecartes.length + ' skipped)' : '')
  else if (tete !== null) raison = 'class ' + classe + ' → ' + tete.modele + ' (not probed: ' + (sonde === 'indisponible' ? 'the llm service is not available' : 'the probe deadline passed') + ')'
  else if (tous.length > 0) raison = 'class ' + classe + ': every candidate is paused or did not answer — keep the session model'
  else raison = 'no ' + classe + ' candidate — keep the session model'
  return {
    actif: true, classe, via,
    modele: tete === null ? null : tete.modele,
    verifie: tete !== null && tete.verifie === true,
    candidats: chaine.map((c) => c.modele),
    chaine, ecartes, sondes, sonde, delai, plafond, raison
  }
}

// ── mounting the routes ─────────────────────────────────────────────────────
const envoyer = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}
/** The strict variant for a route that answers every method alike: a WRITE on it (any method but GET/HEAD) must NAME this listener's
 *  Origin, the way docs/dev/route-origin-rule.md asks; an absent header is refused. Reads keep the rule of `origineOK` (the Host fence
 *  is what stops a rebound page there, and a browser sends no Origin on a same-origin GET). A-16 of the platform audit, 2026-10-20. */
const origineStricte = (req) => {
  const source = String(req.headers.origin || req.headers.referer || '')
  return source !== '' && origineOK(req)
}
const origineOK = (req) => {
  // 2026-10 acceptance (M-02/S-03): the EXACT host of the socket's real listener,
  // never a prefix (« localhost.evil.example » used to pass).
  const o = String(req.headers.origin || '')
  if (o === '') return true
  try {
    const u = new URL(o)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const port = (req.socket && typeof req.socket.localPort === 'number') ? ':' + req.socket.localPort : ''
    return (['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host))
  } catch { return false }
}
const lireCorps = (req) => new Promise((res) => {
  let corps = ''
  req.on('data', (d) => { corps += d })
  req.on('end', () => { try { res(JSON.parse(corps || '{}')) } catch { res({}) } })
})

/** The main-session failover (failover.mjs) wired to the files of this DSH home: the switch is `autoFailover` in
 *  settings.json, the breaker is the delegations' (auto-health.json), the fallbacks are the whitelist's text models. */
export function creerFailover (opts = {}) {
  const univers = opts.univers !== undefined ? opts.univers : creerUnivers({})
  const home = opts.home || dshHome()
  const reglagesFichier = opts.reglagesPath || join(home, 'kybernos', 'settings.json')
  const santeFichier = opts.santePath || join(home, 'kybernos', 'auto-health.json')
  const horloge = opts.horloge || (() => Date.now())
  return createFailover({
    settings: () => ({ enabled: lireReglagesAuto(reglagesFichier).failover === true }),
    health: () => lireSante(santeFichier),
    note: (modele, issue) => { noterIssue(santeFichier, modele, issue, { rapport: true, maintenant: horloge() }) },
    fallbacks: () => {
      univers.lire() // refresh for the next failure: this call cannot wait
      return candidats(listeEffectiveCache(lireReglagesAuto(reglagesFichier), univers), 'agent-task')
    },
    now: horloge,
    log: opts.log || ((ligne) => console.log('[kybernos-auto] ' + ligne))
  })
}

export function monterRoutes (webServerSvc, opts = {}) {
  webServerSvc = kbFenced(webServerSvc)
  const home = opts.home || dshHome()
  const reglagesFichier = opts.reglagesPath || join(home, 'kybernos', 'settings.json')
  const sessionsFichier = opts.sessionsAutoPath || join(home, 'kybernos', 'auto-sessions.json')
  const santeFichier = opts.santePath || join(home, 'kybernos', 'auto-health.json')
  // The llm service, read at call time (DSH may publish it after this plugin mounts); `opts.llm` is a test double.
  const llm = opts.llm !== undefined ? opts.llm : null
  // The configured models (for « all models », « free models » and the check of a typed list); absent = nothing is known.
  const univers = opts.univers !== undefined ? opts.univers : creerUnivers({ modeles: opts.modeles, horloge: opts.horloge })
  const llmDispo = () => llm !== null && typeof llm.stream === 'function'
  const delaiSonde = Number.isFinite(opts.delaiSondeMs) ? opts.delaiSondeMs : parseInt(process.env.KB_AUTO_DELAI || String(DELAI_DEFAUT), 10)
  const horloge = opts.horloge || (() => Date.now())
  /** Probe verdicts, kept for a minute: "always probe first" without asking the same model twice in a breath. */
  const cacheSondes = new Map()
  /** One probe per model at a time: two requests that need the same model share the call instead of making two. */
  const enVol = new Map()
  const sonder = (modele) => {
    if (enVol.has(modele)) return enVol.get(modele)
    const p = sonderUn(llm, modele, delaiSonde, horloge).finally(() => { enVol.delete(modele) })
    enVol.set(modele, p)
    return p
  }
  const noter = (modele, issue) => noterIssue(santeFichier, modele, issue, { maintenant: horloge() })
  let sondeToutEnCours = null
  let derniereSonde = 0

  // Main-session failover (opt-in, `autoFailover`), see creerFailover. `apply` makes it and mounts its hooks before
  // there is a web server (a profile without one, headless or TUI, gets the failover too); the page only reads its view.
  const failover = opts.failover !== undefined && opts.failover !== null
    ? opts.failover
    : creerFailover({ reglagesPath: reglagesFichier, santePath: santeFichier, horloge, univers })

  /** The saved settings with the list Auto really uses in `whitelist` (`explicite` keeps the typed one). */
  const reglagesEffectifs = async () => {
    const reg = lireReglagesAuto(reglagesFichier)
    return { ...reg, explicite: reg.whitelist, whitelist: await listeEffective(reg, univers) }
  }
  const etatComplet = async (sessionId) => {
    const reg = await reglagesEffectifs()
    const sessions = lireSessions(sessionsFichier)
    const on = sessionId ? sessions[String(sessionId)] === true : false
    const maintenant = Date.now()
    const sante = vueSante(lireSante(santeFichier), reg.whitelist, maintenant)
    // "warm cache": the healthy model whose cache hit rate is the highest (≥ 50 %)
    const sains = sante.filter((v) => v.etat !== 'down' && v.cacheHitPct !== null && v.cacheHitPct >= 50)
    sains.sort((a, b) => b.cacheHitPct - a.cacheHitPct)
    return {
      ok: true, global: reg.global, whitelist: reg.whitelist, scope: reg.scope, explicite: reg.explicite, classifier: reg.classifier,
      sessionOn: on, sante,
      total: sante.length, disponibles: sante.filter((v) => v.etat !== 'down').length,
      chaud: sains.length > 0 ? sains[0].modele : null,
      failover: failover.view(),
      sondeEnCours: sondeToutEnCours !== null, sondeMax: SONDE_MAX, plafond: plafondEssais(), ttlSondeS: Math.round(TTL_SONDE_MS / 1000),
      checkedAt: maintenant, intervalS: 60
    }
  }

  webServerSvc.register({ kind: 'exact', path: '/kybernos-auto/state', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    // A-16: this route answers every method, but only a READ is open behind the Host fence; a write must name this listener.
    if (req.method !== 'GET' && req.method !== 'HEAD' && !origineStricte(req)) { res.writeHead(403); res.end('origin refused'); return }
    envoyer(res, 200, await etatComplet(new URL(req.url, 'http://x').searchParams.get('sessionId') || ''))
  } })

  // The configured models, for the picker of the typed list (read-only: `route/id` and whether the provider is connected).
  webServerSvc.register({ kind: 'exact', path: '/kybernos-auto/models', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    // A-16: same rule as /state above (the picker only reads; a local program with no Origin may not drive any other method).
    if (req.method !== 'GET' && req.method !== 'HEAD' && !origineStricte(req)) { res.writeHead(403); res.end('origin refused'); return }
    univers.oublier()
    const connus = await univers.lire()
    envoyer(res, 200, { ok: true, models: (connus === null ? [] : connus).map((x) => ({ cle: x.cle, route: x.route, id: x.id, connecte: x.connecte === true, locale: x.locale === true })) })
  } })

  webServerSvc.register({ kind: 'exact', path: '/kybernos-auto/session', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST expected'); return }
    if (!ecritureAutorisee(req, res)) return
    const corps = await lireCorps(req)
    const r = ecrireSession(sessionsFichier, corps.sessionId, corps.on === true)
    envoyer(res, r.ok === true ? 200 : 400, r.ok === true
      ? { ...(await etatComplet(corps.sessionId)), on: r.on }
      : { ok: false, erreur: r.erreur })
  } })

  webServerSvc.register({ kind: 'exact', path: '/kybernos-auto/settings', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST expected'); return }
    if (!ecritureAutorisee(req, res)) return
    const corps = await lireCorps(req)
    // Whitelist and classifier: the same global keys as settings.json — the
    // dedicated page is their main writer. Validate first, touch the disk after.
    const maj = {}
    // Every refusal of this route carries a CODE: the host keeps the code and an English sentence, the page words the code in the
    // person's language (client.js, refusTxt). A refusal without a code reaches the page as English text in a French interface.
    if (corps.autoWhitelist !== undefined) {
      // The shape (an array of strings) and the count (64 at most, no duplicate) are two causes, so two codes.
      const forme = Array.isArray(corps.autoWhitelist) && corps.autoWhitelist.every((x) => typeof x === 'string' && x.length <= 200)
      if (forme !== true) {
        envoyer(res, 400, { ok: false, code: 'liste-type', erreur: 'autoWhitelist: an array of strings (200 characters at most each) was expected' }); return
      }
      if (corps.autoWhitelist.length > 64 || new Set(corps.autoWhitelist).size !== corps.autoWhitelist.length) {
        envoyer(res, 400, { ok: false, code: 'liste', erreur: 'autoWhitelist: at most 64 unique ids were expected' }); return
      }
      // A list of models is a list of `provider/model` the profile knows (A3-24): « model-only », « a b/c d » or « <script>/x »
      // used to be saved and then « really asked » by the health check. The existence is judged only when the host can read the
      // profile; the form always.
      univers.oublier()
      const connus = await univers.lire()
      const refus = refuserListe(corps.autoWhitelist, connus === null ? null : new Set(connus.map((x) => x.cle)))
      if (refus !== null) {
        envoyer(res, 400, { ok: false, code: 'liste-' + refus.code, cles: refus.cles.slice(0, 5), erreur: (refus.code === 'forme'
          ? 'autoWhitelist: “' + refus.cles[0] + '” is not a provider/model name'
          : 'autoWhitelist: “' + refus.cles[0] + '” is not a configured model') }); return
      }
      maj.autoWhitelist = corps.autoWhitelist
    }
    if (corps.autoScope !== undefined) {
      if (SCOPES.indexOf(corps.autoScope) < 0) { envoyer(res, 400, { ok: false, code: 'scope', erreur: 'autoScope: all, free or custom expected' }); return }
      maj.autoScope = corps.autoScope
    }
    if (corps.autoRouting !== undefined) {
      // Inherited GLOBAL breaker: true forces Auto on every session.
      if (typeof corps.autoRouting !== 'boolean') { envoyer(res, 400, { ok: false, code: 'routage', erreur: 'autoRouting: a boolean was expected' }); return }
      maj.autoRouting = corps.autoRouting
    }
    if (corps.autoFailover !== undefined) {
      if (typeof corps.autoFailover !== 'boolean') { envoyer(res, 400, { ok: false, code: 'failover', erreur: 'autoFailover: a boolean was expected' }); return }
      maj.autoFailover = corps.autoFailover
    }
    if (corps.autoClassifier !== undefined) {
      if (typeof corps.autoClassifier !== 'string' || corps.autoClassifier.length > 200) {
        envoyer(res, 400, { ok: false, code: 'classifieur', erreur: 'autoClassifier: a string (200 characters at most) was expected' }); return
      }
      maj.autoClassifier = corps.autoClassifier
    }
    const lu = readRawSettings(reglagesFichier)
    const bloque = settingsFileBlocked(lu, reglagesFichier)
    if (bloque !== null) { envoyer(res, 500, { ok: false, code: 'settings-illisible', erreur: bloque }); return }
    try {
      writeFileAtomically(reglagesFichier, JSON.stringify({ ...lu.raw, ...maj }, null, 2) + '\n')
      envoyer(res, 200, await etatComplet(''))
    } catch (e) {
      envoyer(res, 500, { ok: false, code: 'ecriture', erreur: String(e && e.message ? e.message : e) })
    }
  } })

  // Report of a delegation's outcome: real latency, error, cache usage.
  // It is the caller (workflow, kyber, CLI) that knows the outcome — the router
  // alone does not see it. Feeds the Latency / Errors / Cache hit columns.
  // LEFT OPEN ON PURPOSE (no session cookie, an Origin is only refused when it is foreign): the caller is `cli/auto-router.mjs` (--report), copied to
  // ~/.dsh/tools/ for the agent, a Node program that sends no Origin and has no browser session. `/router` below has the same caller.
  webServerSvc.register({ kind: 'exact', path: '/kybernos-auto/report', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST expected'); return }
    const c = await lireCorps(req)
    if (typeof c.modele !== 'string' || c.modele === '' || c.modele.length > 200) { envoyer(res, 400, { ok: false, erreur: 'model expected' }); return }
    if (c.latenceMs !== undefined && !(Number.isFinite(c.latenceMs) && c.latenceMs >= 0)) { envoyer(res, 400, { ok: false, erreur: 'latenceMs: a number >= 0 was expected' }); return }
    if (c.code !== undefined && (typeof c.code !== 'string' || c.code.length > 100)) { envoyer(res, 400, { ok: false, erreur: 'code: a string of 100 characters at most was expected' }); return }
    if (c.message !== undefined && typeof c.message !== 'string') { envoyer(res, 400, { ok: false, erreur: 'message: a string was expected' }); return }
    // The outcome keeps its reason (code, message, when): the page says WHY a model is skipped, and the breaker learns from it.
    const issue = issueDeRapport({ erreur: c.erreur === true, code: c.code, message: c.message })
    noterIssue(santeFichier, c.modele, issue, { rapport: true, latenceMs: c.latenceMs, usage: { inputTokens: c.inputTokens, cacheReadTokens: c.cacheReadTokens }, maintenant: horloge() })
    envoyer(res, 200, { ...(await etatComplet('')), issue: { etat: issue.etat, code: issue.code } })
  } })

  // "Re-check now": probe the whitelist (or the models named) for real, bypassing the verdict cache. A success closes a
  // model's breaker, a failure counts against it. One run at a time: a second call waits for the first.
  webServerSvc.register({ kind: 'exact', path: '/kybernos-auto/probe', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST expected'); return }
    if (!ecritureAutorisee(req, res)) return
    const corps = await lireCorps(req)
    if (!llmDispo()) { envoyer(res, 503, { ok: false, code: 'llm-indisponible', erreur: 'llm service unavailable: nothing can be probed' }); return }
    const reg = await reglagesEffectifs()
    // Only whitelist models are ever probed: these routes need no login (DSH serves plugin routes before its own
    // authentication), so they must not become a way to make the server call arbitrary models.
    // With « all models » the list can be long: a run asks the first SONDE_MAX, in the order Auto would try them (a real call each).
    const liste = corps.models === undefined ? reg.whitelist.slice(0, SONDE_MAX) : normaliserListe(corps.models).filter((m) => reg.whitelist.indexOf(m) >= 0)
    // …nor a way to burn tokens: a run that ended less than five seconds ago answers again with its result.
    if (sondeToutEnCours === null && horloge() - derniereSonde >= 5000) {
      sondeToutEnCours = (async () => {
        let curseur = 0
        const ouvriers = Array.from({ length: Math.max(1, Math.min(4, liste.length)) }, async () => {
          for (;;) {
            const k = curseur
            curseur += 1
            if (k >= liste.length) return
            const issue = await sonder(liste[k])
            cacheSondes.set(liste[k], { at: horloge(), issue })
            noter(liste[k], issue)
          }
        })
        await Promise.all(ouvriers)
      })().finally(() => { sondeToutEnCours = null; derniereSonde = horloge() })
    }
    if (sondeToutEnCours !== null) await sondeToutEnCours
    envoyer(res, 200, await etatComplet(''))
  } })

  // LEFT OPEN ON PURPOSE, like /report: `cli/auto-router.mjs` (the agent's reflex before a delegation) calls it with no Origin and no cookie.
  webServerSvc.register({ kind: 'exact', path: '/kybernos-auto/router', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST expected'); return }
    const corps = await lireCorps(req)
    const demande = String(corps.demande || '').trim()
    if (demande === '') { envoyer(res, 400, { ok: false, erreur: 'request expected' }); return }
    const sessionId = String(corps.sessionId || '')
    const sessions = lireSessions(sessionsFichier)
    const reg = await reglagesEffectifs()
    // Activation: PER SESSION (the composer's chip) — the global inherited from the
    // first iteration stays a breaker (ON forces every session,
    // the CLI with no sessionId included).
    const actifPourSession = reg.global === true || (sessionId !== '' && sessions[sessionId] === true)
    if (actifPourSession === false) { envoyer(res, 200, { actif: false, raison: 'auto off for this session' }); return }
    // The caller may name models that just failed for this very delegation: the answer is then the NEXT ones.
    const exclure = corps.exclure === undefined ? [] : corps.exclure
    if (!Array.isArray(exclure) || exclure.length > 64 || !exclure.every((x) => typeof x === 'string' && x.length <= 200)) {
      envoyer(res, 400, { ok: false, erreur: 'exclure: an array of 64 ids at most was expected' }); return
    }
    // The route has already decided the activation: the router must not veto it again. A caller that cannot wait for
    // probes says `sonde: false`; with no llm service nothing can be probed, and the chain is told so.
    const r = await router(demande, {
      reglages: { ...reg, global: true }, sante: lireSante(santeFichier), ollama: opts.ollama, exclure, horloge,
      sonder: corps.sonde !== false && llmDispo() ? sonder : undefined, noter, cache: cacheSondes, delaiMs: opts.delaiTotalMs
    })
    envoyer(res, 200, r)
  } })

  return { failover }
}

/** The three events of the main-session failover (failover.mjs). Each registration is guarded on its own: a DSH
 *  that lacks one of them goes without the feature, and nothing here can stop it from starting. */
export function mountFailover (ctx, failover) {
  const hooks = [
    ['agent/request', (payload, next) => failover.onRequest(payload, next), undefined],
    // First in line: the transient failures are handed on with `next()` to the engine's own retries, the immediate ones are not.
    ['agent/request-error', (payload, next) => failover.onRequestError(payload, next), { prepend: true }],
    ['agent/assistant-stream', (payload) => failover.onStream(payload), undefined]
  ]
  for (const [event, handler, options] of hooks) {
    try {
      ctx.effect(() => (options === undefined ? ctx.on(event, handler) : ctx.on(event, handler, options)), 'kybernos-auto: failover ' + event)
    } catch (e) {
      console.error('[kybernos-auto] failover: ' + event + ' not hooked', e)
    }
  }
}

export function apply (ctx) {
  if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') ctx.effect(() => kbRetirerRoutes, 'kybernos-auto: routes')
  // The failover needs no web server: its hooks are mounted first, and guarded on their own.
  let failover = null
  // One reading of the configured models for the failover and the routes: « all models » means what is connected NOW.
  const univers = creerUnivers({ modeles: modelesDeLHote(ctx) })
  try {
    failover = creerFailover({ univers })
    univers.lire() // first reading in the background, so the first failover already knows the list
    mountFailover(ctx, failover)
  } catch (e) {
    failover = null
    console.error('[kybernos-auto] failover non monte', e)
  }
  try {
    const monter = (hostCtx) => {
      // The llm service is read AT CALL TIME, as a getter, not at mount: DSH may publish it after this plugin, and a plugin
      // that refused to mount would lose all its routes. `typeof llm.stream` is how the probe says "service unavailable".
      const llmParesseux = {
        get stream () {
          let svc = null
          try { svc = ctx.get('llm') } catch (e) { svc = null }
          return svc === null || svc === undefined || typeof svc.stream !== 'function' ? undefined : svc.stream.bind(svc)
        }
      }
      monterRoutes(hostCtx.webServer, { llm: llmParesseux, failover, univers })
      console.log('[kybernos-auto] routes /kybernos-auto/* enregistrees (state, session, settings, router, report, probe)')
    }
    if (ctx.get('webServer') !== undefined) monter(ctx)
    else ctx.inject(['webServer'], monter)
  } catch (e) {
    console.error('[kybernos-auto] demarrage impossible', e)
  }
}
