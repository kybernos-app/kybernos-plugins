// ═══════════════════════════════════════════════════════════════════════════
// kybernos-auto — moitié hôte.
//
// Le mode Auto, dans UN bundle dédié (02/10/2026, décision utilisateur) :
//   • état PAR SESSION   → <DSH home>/kybernos/auto-sessions.json  (~/.dsh par défaut)
//   • whitelist/classifieur (globaux) → <DSH home>/kybernos/settings.json
//     (mêmes clés que la première itération : autoRouting* y restent lisibles,
//     la page Settings dédiée du bundle les écrit désormais)
//   • santé par modèle   → <DSH home>/kybernos/auto-health.json (compteurs locaux
//     écrits à chaque routage : appels, erreurs, dernière latence)
//   • le routeur lui-même (règles → classifieur local tev1 → whitelist)
//
// Le routeur est une COPIE conforme du CLI `~/.dsh/tools/auto-router.mjs`
// (contrat identique, mêmes classes chat|code|vision|media|agent-task). Le CLI
// reste autonome pour l'agent ; l'hôte sert la page et la puce du composer.
// ═══════════════════════════════════════════════════════════════════════════

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, realpathSync, renameSync, chmodSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { DELAI_DEFAUT, normaliserListe, sonderUn } from './sonde.mjs'
import { TTL_SONDE_MS, apresIssue, issueDeRapport, plafondEssais, resoudre, triCandidats, vueModele } from './resilience.mjs'
// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle publishes the predicate
// (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers false and the guard stays loopback-only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }

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

// ── réglages (whitelist + classifieur) : mêmes clés que settings.json ───────
export function lireReglagesAuto (fichier) {
  let brut = {}
  try { brut = JSON.parse(readFileSync(fichier, 'utf8')) } catch { brut = {} }
  const whitelistValide = Array.isArray(brut.autoWhitelist) &&
    brut.autoWhitelist.length <= 64 &&
    brut.autoWhitelist.every((x) => typeof x === 'string' && x.length <= 200) &&
    new Set(brut.autoWhitelist).size === brut.autoWhitelist.length
  return {
    whitelist: whitelistValide === true ? brut.autoWhitelist : [],
    classifier: typeof brut.autoClassifier === 'string' ? brut.autoClassifier : '',
    global: brut.autoRouting === true
  }
}

// ── état PAR SESSION ────────────────────────────────────────────────────────
export function lireSessions (fichier) {
  let brut = {}
  try { brut = JSON.parse(readFileSync(fichier, 'utf8')) } catch { brut = {} }
  return (brut !== null && typeof brut === 'object' && !Array.isArray(brut)) ? brut : {}
}

export function ecrireSession (fichier, sessionId, on) {
  const id = String(sessionId || '').trim()
  if (id === '' || id.length > 200) return { ok: false, erreur: 'sessionId attendu' }
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
  if (whitelist.length === 0) return { actif: true, classe: null, modele: null, raison: 'whitelist vide' }

  let classe = regle(demande)
  let via = 'regle'
  if (classe === null && reg.classifier) {
    try {
      classe = await classifie(demande, reg.classifier, opts.ollama)
      via = 'classifieur'
    } catch (e) {
      via = 'classifieur en échec (' + (e && e.message ? e.message : e) + ')'
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

// ── montage des routes ──────────────────────────────────────────────────────
const envoyer = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}
const origineOK = (req) => {
  // Recette 2026-10 (M-02/S-03) : hôte EXACT de l'écoute réelle du socket,
  // jamais un préfixe (« localhost.evil.example » passait).
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

export function monterRoutes (webServerSvc, opts = {}) {
  const home = opts.home || dshHome()
  const reglagesFichier = opts.reglagesPath || join(home, 'kybernos', 'settings.json')
  const sessionsFichier = opts.sessionsAutoPath || join(home, 'kybernos', 'auto-sessions.json')
  const santeFichier = opts.santePath || join(home, 'kybernos', 'auto-health.json')
  // The llm service, read at call time (DSH may publish it after this plugin mounts); `opts.llm` is a test double.
  const llm = opts.llm !== undefined ? opts.llm : null
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

  const etatComplet = (sessionId) => {
    const reg = lireReglagesAuto(reglagesFichier)
    const sessions = lireSessions(sessionsFichier)
    const on = sessionId ? sessions[String(sessionId)] === true : false
    const maintenant = Date.now()
    const sante = vueSante(lireSante(santeFichier), reg.whitelist, maintenant)
    // "warm cache": the healthy model whose cache hit rate is the highest (≥ 50 %)
    const sains = sante.filter((v) => v.etat !== 'down' && v.cacheHitPct !== null && v.cacheHitPct >= 50)
    sains.sort((a, b) => b.cacheHitPct - a.cacheHitPct)
    return {
      ok: true, global: reg.global, whitelist: reg.whitelist, classifier: reg.classifier,
      sessionOn: on, sante,
      total: sante.length, disponibles: sante.filter((v) => v.etat !== 'down').length,
      chaud: sains.length > 0 ? sains[0].modele : null,
      sondeEnCours: sondeToutEnCours !== null, plafond: plafondEssais(), ttlSondeS: Math.round(TTL_SONDE_MS / 1000),
      checkedAt: maintenant, intervalS: 60
    }
  }

  webServerSvc.register({ kind: 'exact', path: '/kybernos-auto/state', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    envoyer(res, 200, etatComplet(new URL(req.url, 'http://x').searchParams.get('sessionId') || ''))
  } })

  webServerSvc.register({ kind: 'exact', path: '/kybernos-auto/session', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST attendu'); return }
    const corps = await lireCorps(req)
    const r = ecrireSession(sessionsFichier, corps.sessionId, corps.on === true)
    envoyer(res, r.ok === true ? 200 : 400, r.ok === true
      ? { ...etatComplet(corps.sessionId), on: r.on }
      : { ok: false, erreur: r.erreur })
  } })

  webServerSvc.register({ kind: 'exact', path: '/kybernos-auto/settings', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST attendu'); return }
    const corps = await lireCorps(req)
    // Whitelist and classifier: the same global keys as settings.json — the
    // dedicated page is their main writer. Validate first, touch the disk after.
    const maj = {}
    if (corps.autoWhitelist !== undefined) {
      const valide = Array.isArray(corps.autoWhitelist) && corps.autoWhitelist.length <= 64 &&
        corps.autoWhitelist.every((x) => typeof x === 'string' && x.length <= 200) &&
        new Set(corps.autoWhitelist).size === corps.autoWhitelist.length
      if (valide !== true) {
        envoyer(res, 400, { ok: false, erreur: 'autoWhitelist : tableau d identifiants sans doublon attendu' }); return
      }
      maj.autoWhitelist = corps.autoWhitelist
    }
    if (corps.autoRouting !== undefined) {
      // Disjoncteur GLOBAL hérité : true force Auto sur toutes les sessions.
      if (typeof corps.autoRouting !== 'boolean') { envoyer(res, 400, { ok: false, erreur: 'autoRouting : booléen attendu' }); return }
      maj.autoRouting = corps.autoRouting
    }
    if (corps.autoClassifier !== undefined) {
      if (typeof corps.autoClassifier !== 'string' || corps.autoClassifier.length > 200) {
        envoyer(res, 400, { ok: false, erreur: 'autoClassifier : chaîne attendue' }); return
      }
      maj.autoClassifier = corps.autoClassifier
    }
    const lu = readRawSettings(reglagesFichier)
    const bloque = settingsFileBlocked(lu, reglagesFichier)
    if (bloque !== null) { envoyer(res, 500, { ok: false, erreur: bloque }); return }
    try {
      writeFileAtomically(reglagesFichier, JSON.stringify({ ...lu.raw, ...maj }, null, 2) + '\n')
      envoyer(res, 200, etatComplet(''))
    } catch (e) {
      envoyer(res, 500, { ok: false, erreur: String(e && e.message ? e.message : e) })
    }
  } })

  // Rapport d'issue d'une délégation : latence réelle, erreur, usage de cache.
  // C'est l'appelant (workflow, kyber, CLI) qui connaît l'issue — le routeur
  // seul ne la voit pas. Alimente les colonnes Latence / Erreurs / Cache hit.
  webServerSvc.register({ kind: 'exact', path: '/kybernos-auto/report', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST attendu'); return }
    const c = await lireCorps(req)
    if (typeof c.modele !== 'string' || c.modele === '' || c.modele.length > 200) { envoyer(res, 400, { ok: false, erreur: 'modele attendu' }); return }
    if (c.latenceMs !== undefined && !(Number.isFinite(c.latenceMs) && c.latenceMs >= 0)) { envoyer(res, 400, { ok: false, erreur: 'latenceMs : nombre >= 0 attendu' }); return }
    if (c.code !== undefined && (typeof c.code !== 'string' || c.code.length > 100)) { envoyer(res, 400, { ok: false, erreur: 'code : chaîne de 100 caractères max attendue' }); return }
    if (c.message !== undefined && typeof c.message !== 'string') { envoyer(res, 400, { ok: false, erreur: 'message : chaîne attendue' }); return }
    // The outcome keeps its reason (code, message, when): the page says WHY a model is skipped, and the breaker learns from it.
    const issue = issueDeRapport({ erreur: c.erreur === true, code: c.code, message: c.message })
    noterIssue(santeFichier, c.modele, issue, { rapport: true, latenceMs: c.latenceMs, usage: { inputTokens: c.inputTokens, cacheReadTokens: c.cacheReadTokens }, maintenant: horloge() })
    envoyer(res, 200, { ...etatComplet(''), issue: { etat: issue.etat, code: issue.code } })
  } })

  // "Re-check now": probe the whitelist (or the models named) for real, bypassing the verdict cache. A success closes a
  // model's breaker, a failure counts against it. One run at a time: a second call waits for the first.
  webServerSvc.register({ kind: 'exact', path: '/kybernos-auto/probe', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST attendu'); return }
    const corps = await lireCorps(req)
    if (!llmDispo()) { envoyer(res, 503, { ok: false, erreur: 'llm service unavailable: nothing can be probed' }); return }
    const reg = lireReglagesAuto(reglagesFichier)
    // Only whitelist models are ever probed: these routes need no login (DSH serves plugin routes before its own
    // authentication), so they must not become a way to make the server call arbitrary models.
    const liste = corps.models === undefined ? reg.whitelist : normaliserListe(corps.models).filter((m) => reg.whitelist.indexOf(m) >= 0)
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
    envoyer(res, 200, etatComplet(''))
  } })

  webServerSvc.register({ kind: 'exact', path: '/kybernos-auto/router', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST attendu'); return }
    const corps = await lireCorps(req)
    const demande = String(corps.demande || '').trim()
    if (demande === '') { envoyer(res, 400, { ok: false, erreur: 'demande attendue' }); return }
    const sessionId = String(corps.sessionId || '')
    const sessions = lireSessions(sessionsFichier)
    const reg = lireReglagesAuto(reglagesFichier)
    // Activation : PAR SESSION (la puce du composer) — le global hérité de la
    // première itération reste un disjoncteur (ON force toutes les sessions,
    // dont le CLI sans sessionId).
    const actifPourSession = reg.global === true || (sessionId !== '' && sessions[sessionId] === true)
    if (actifPourSession === false) { envoyer(res, 200, { actif: false, raison: 'auto off pour cette session' }); return }
    // The caller may name models that just failed for this very delegation: the answer is then the NEXT ones.
    const exclure = corps.exclure === undefined ? [] : corps.exclure
    if (!Array.isArray(exclure) || exclure.length > 64 || !exclure.every((x) => typeof x === 'string' && x.length <= 200)) {
      envoyer(res, 400, { ok: false, erreur: 'exclure : tableau de 64 identifiants max attendu' }); return
    }
    // The route has already decided the activation: the router must not veto it again. A caller that cannot wait for
    // probes says `sonde: false`; with no llm service nothing can be probed, and the chain is told so.
    const r = await router(demande, {
      reglages: { ...reg, global: true }, sante: lireSante(santeFichier), ollama: opts.ollama, exclure, horloge,
      sonder: corps.sonde !== false && llmDispo() ? sonder : undefined, noter, cache: cacheSondes, delaiMs: opts.delaiTotalMs
    })
    envoyer(res, 200, r)
  } })
}

export function apply (ctx) {
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
      monterRoutes(hostCtx.webServer, { llm: llmParesseux })
      console.log('[kybernos-auto] routes /kybernos-auto/* enregistrees (state, session, settings, router, report, probe)')
    }
    if (ctx.get('webServer') !== undefined) monter(ctx)
    else ctx.inject(['webServer'], monter)
  } catch (e) {
    console.error('[kybernos-auto] demarrage impossible', e)
  }
}
