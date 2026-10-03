// ═══════════════════════════════════════════════════════════════════════════
// kybernos-auto — moitié hôte.
//
// Le mode Auto, dans UN bundle dédié (02/10/2026, décision utilisateur) :
//   • état PAR SESSION   → ~/.dsh/kybernos/auto-sessions.json
//   • whitelist/classifieur (globaux) → ~/.dsh/kybernos/settings.json
//     (mêmes clés que la première itération : autoRouting* y restent lisibles,
//     la page Settings dédiée du bundle les écrit désormais)
//   • santé par modèle   → ~/.dsh/kybernos/auto-health.json (compteurs locaux
//     écrits à chaque routage : appels, erreurs, dernière latence)
//   • le routeur lui-même (règles → classifieur local tev1 → whitelist)
//
// Le routeur est une COPIE conforme du CLI `~/.dsh/tools/auto-router.mjs`
// (contrat identique, mêmes classes chat|code|vision|media|agent-task). Le CLI
// reste autonome pour l'agent ; l'hôte sert la page et la puce du composer.
// ═══════════════════════════════════════════════════════════════════════════

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'kybernos-auto'

const OLLAMA = process.env.AUTO_ROUTER_OLLAMA || 'http://127.0.0.1:11434'
const CLASSES = ['chat', 'code', 'vision', 'media', 'agent-task']

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

// ── santé : compteurs LOCAUX, dérivés des routages réels ────────────────────
export function lireSante (fichier) {
  let brut = {}
  try { brut = JSON.parse(readFileSync(fichier, 'utf8')) } catch { brut = {} }
  return (brut !== null && typeof brut === 'object' && !Array.isArray(brut)) ? brut : {}
}

export function noterRoutage (fichier, modele, latenceMs, erreur, usage) {
  if (typeof modele !== 'string' || modele === '' || modele.length > 200) return
  const sante = lireSante(fichier)
  const m = sante[modele] || { calls: 0, errors: 0, lastLatencyMs: null, cacheInput: 0, cacheRead: 0, updatedAt: null }
  m.calls += 1
  if (erreur === true) m.errors += 1
  if (typeof latenceMs === 'number' && latenceMs >= 0) m.lastLatencyMs = Math.round(latenceMs)
  // cache : le rapport porte les tokens d'entrée et ceux lus depuis le cache
  if (usage && Number.isFinite(usage.inputTokens) && usage.inputTokens > 0 &&
      Number.isFinite(usage.cacheReadTokens) && usage.cacheReadTokens >= 0 && usage.cacheReadTokens <= usage.inputTokens) {
    m.cacheInput = (m.cacheInput || 0) + usage.inputTokens
    m.cacheRead = (m.cacheRead || 0) + usage.cacheReadTokens
  }
  m.updatedAt = Date.now()
  sante[modele] = m
  try {
    mkdirSync(dirname(fichier), { recursive: true })
    writeFileSync(fichier, JSON.stringify(sante, null, 2) + '\n')
  } catch { /* un compteur perdu ne casse jamais un routage */ }
}

/** Vue « santé » pour la page : pour chaque modèle de la whitelist, ses
 *  compteurs (ou un état « jamais routé »), et un état dérivé simple.
 *  « down » = taux d'erreurs ≥ 25 % sur ≥ 3 appels ; « degrade » = ≥ 5 %.
 *  Un modèle simplement inactif n'est JAMAIS écarté (pas de péremption). */
export function vueSante (sante, whitelist) {
  return whitelist.map((modele) => {
    const m = sante[modele] || null
    if (m === null || m.calls === 0) return { modele, etat: 'jamais', calls: 0, errors: 0, erreurPct: null, lastLatencyMs: null, cacheHitPct: null }
    const erreurPct = Math.round((m.errors / m.calls) * 1000) / 10
    let etat = 'ok'
    if (m.calls >= 3 && erreurPct >= 25) etat = 'down'
    else if (erreurPct >= 5) etat = 'degrade'
    const cacheHitPct = (m.cacheInput || 0) > 0 ? Math.round(((m.cacheRead || 0) / m.cacheInput) * 100) : null
    return { modele, etat, calls: m.calls, errors: m.errors, erreurPct, lastLatencyMs: m.lastLatencyMs, cacheHitPct }
  })
}

// ── le routeur (copie conforme du CLI) ──────────────────────────────────────
const REGLES = [
  ['media', /\b(vi[ée]deo|g[ée]n[è]re[sr]?\s+(une?\s+)?(vid[ée]o|image|icone)|tts|voix de synth|doublag|sous-titr)/i],
  ['vision', /\b(regarde[sr]?\s+(l['’]?[ée]cran|l'image|la capture)|capture d['’]?[ée]cran|lis (ce|cette) (png|jpg|image)|planche contact)/i],
  ['code', /\b(bug|refactor|corrige|patch|compile|test unitaire|migration|typescript|lint|pagination|feature|composant)/i]
]
const regle = (demande) => {
  for (const [classe, re] of REGLES) if (re.test(demande)) return classe
  return null
}

function candidats (whitelist, classe) {
  const indices = {
    media: /(wan|image|video|happyhorse|tts|audio|asr)/i,
    vision: /(vision|5v|-vl|glm-5\.3-flash)/i,
    code: /(deepseek-chat|code|devstral|qwen-coder)/i
  }
  const re = indices[classe]
  const surprise = whitelist.filter((m) => re && re.test(m))
  if (surprise.length > 0) return surprise
  if (classe === 'chat' || classe === 'agent-task' || classe === 'code') {
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

/** Le routage : règles → classifieur → whitelist. `deja` (santé) peut EXCLURE
 *  un modèle down. Rend { actif, classe, via, modele, candidats, raison }. */
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
  const sante = opts.sante || {}
  const sains = candidats(whitelist, classe).filter((m) => {
    const s = sante[m]
    return s === undefined || s.etat !== 'down'
  })
  const tous = candidats(whitelist, classe)
  // Tous les candidats « down » : on n'envoie PAS vers un modèle en panne, on
  // garde le modèle de session (« skipped until it recovers », page Settings).
  const liste = sains
  return {
    actif: true, classe, via,
    modele: liste.length > 0 ? liste[0] : null,
    candidats: liste,
    raison: liste.length > 0
      ? 'classe ' + classe + ' → premier candidat sain de la whitelist'
      : (tous.length > 0
        ? 'classe ' + classe + ' : tous les candidats sont hors service — garder le modèle de session'
        : 'aucun candidat ' + classe + ' — garder le modèle de session')
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
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0
  } catch { return false }
}
const lireCorps = (req) => new Promise((res) => {
  let corps = ''
  req.on('data', (d) => { corps += d })
  req.on('end', () => { try { res(JSON.parse(corps || '{}')) } catch { res({}) } })
})

export function monterRoutes (webServerSvc, opts = {}) {
  const home = opts.home || join(process.env.DSH_HOME || homedir(), '.dsh')
  const reglagesFichier = opts.reglagesPath || join(home, 'kybernos', 'settings.json')
  const sessionsFichier = opts.sessionsAutoPath || join(home, 'kybernos', 'auto-sessions.json')
  const santeFichier = opts.santePath || join(home, 'kybernos', 'auto-health.json')

  const etatComplet = (sessionId) => {
    const reg = lireReglagesAuto(reglagesFichier)
    const sessions = lireSessions(sessionsFichier)
    const on = sessionId ? sessions[String(sessionId)] === true : false
    const sante = vueSante(lireSante(santeFichier), reg.whitelist)
    // « cache chaud » : le modèle sain dont le taux de cache est le plus haut (≥ 50 %)
    const sains = sante.filter((v) => v.etat !== 'down' && v.cacheHitPct !== null && v.cacheHitPct >= 50)
    sains.sort((a, b) => b.cacheHitPct - a.cacheHitPct)
    return {
      ok: true, global: reg.global, whitelist: reg.whitelist, classifier: reg.classifier,
      sessionOn: on, sante,
      total: sante.length, disponibles: sante.filter((v) => v.etat !== 'down').length,
      chaud: sains.length > 0 ? sains[0].modele : null,
      checkedAt: Date.now(), intervalS: 60
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
    // Whitelist et classifieur : mêmes clés globales que settings.json — la
    // page dédiée devient leur écrivain principal.
    let brut = {}
    try { brut = JSON.parse(readFileSync(reglagesFichier, 'utf8')) } catch { brut = {} }
    if (corps.autoWhitelist !== undefined) {
      const valide = Array.isArray(corps.autoWhitelist) && corps.autoWhitelist.length <= 64 &&
        corps.autoWhitelist.every((x) => typeof x === 'string' && x.length <= 200) &&
        new Set(corps.autoWhitelist).size === corps.autoWhitelist.length
      if (valide !== true) {
        envoyer(res, 400, { ok: false, erreur: 'autoWhitelist : tableau d identifiants sans doublon attendu' }); return
      }
      brut.autoWhitelist = corps.autoWhitelist
    }
    if (corps.autoRouting !== undefined) {
      // Disjoncteur GLOBAL hérité : true force Auto sur toutes les sessions.
      if (typeof corps.autoRouting !== 'boolean') { envoyer(res, 400, { ok: false, erreur: 'autoRouting : booléen attendu' }); return }
      brut.autoRouting = corps.autoRouting
    }
    if (corps.autoClassifier !== undefined) {
      if (typeof corps.autoClassifier !== 'string' || corps.autoClassifier.length > 200) {
        envoyer(res, 400, { ok: false, erreur: 'autoClassifier : chaîne attendue' }); return
      }
      brut.autoClassifier = corps.autoClassifier
    }
    try {
      mkdirSync(dirname(reglagesFichier), { recursive: true })
      writeFileSync(reglagesFichier, JSON.stringify(brut, null, 2) + '\n')
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
    noterRoutage(santeFichier, c.modele, c.latenceMs, c.erreur === true, { inputTokens: c.inputTokens, cacheReadTokens: c.cacheReadTokens })
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
    // la route a déjà tranché l'activation : le routeur ne doit pas re-vetoer
    const r = await router(demande, { reglages: { ...reg, global: true }, sante: vueSanteIndexee(lireSante(santeFichier)), ollama: opts.ollama })
    if (r.modele !== null) noterRoutage(santeFichier, r.modele, null, false)
    envoyer(res, 200, r)
  } })
}

const vueSanteIndexee = (sante) => {
  const vue = vueSante(sante, Object.keys(sante))
  const index = {}
  for (const v of vue) index[v.modele] = v
  return index
}

export function apply (ctx) {
  try {
    const monter = (hostCtx) => {
      monterRoutes(hostCtx.webServer, { home: process.env.DSH_HOME || join(homedir(), '.dsh') })
      console.log('[kybernos-auto] routes /kybernos-auto/* enregistrees (state, session, settings, router, report)')
    }
    if (ctx.get('webServer') !== undefined) monter(ctx)
    else ctx.inject(['webServer'], monter)
  } catch (e) {
    console.error('[kybernos-auto] demarrage impossible', e)
  }
}
