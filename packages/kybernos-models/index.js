// ── Plugin hôte « kybernos-models » ─────────────────────────────────────────
// Le catalogue de modèles personnalisé : une surcouche de la page
// « Settings → Models » qui préremplit les caractéristiques d'un modèle depuis
// models.dev et laisse l'utilisateur les surcharger.
//
// DEUX NIVEAUX, et c'est le cœur du contrat :
//
//   · APPLIQUÉ AU HARNAIS — six champs seulement sont acceptés par `llm-pi-ai`
//     pour un modèle installé (`providers.<route>.modelOverrides.<id>`) :
//     `name`, `contextWindow`, `maxTokens`, `input`, `reasoningEfforts`,
//     `compat`. Écrits dans `settings.yaml`, ils changent réellement les appels
//     suivants, sans redémarrage (le profil est relu à chaque opération).
//
//   · ANNOTATION KYBERNOS — tout le reste de la maquette (pricing, type, family,
//     knowledge, release, weights, sorties TTS/image/vidéo, `search`, `s2s`,
//     max input) n'a AUCUN équivalent dans la configuration du harnais : le
//     service de modèles ne lit pas le coût (« the absence of a fact, not a
//     configurable rate ») et ne connaît que deux modalités d'entrée, `text` et
//     `image`. Ces valeurs vivent donc dans un fichier du plugin et servent les
//     vues Kybernos (coût, lisibilité) — jamais les appels.
//
// Ce fichier est la moitié HOST : elle possède le fichier d'annotations et
// l'index models.dev mis en cache (4,7 Mo : un seul téléchargement pour tout le
// monde, jamais par navigateur). L'écriture des champs appliqués, elle, passe
// par `remote.settings.mutate` côté client — exactement le chemin qu'emprunte
// la page Models native — pour que la validation du service settings soit la
// même des deux côtés.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle publishes the predicate
// (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers false and the guard stays loopback-only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }

const pluginDir = dirname(fileURLToPath(import.meta.url))

/** Version du contrat de données exposé au client. */
export const MODEL_CATALOG_VERSION = 1

/** Les six champs qu'un profil `llm-pi-ai` accepte PAR MODÈLE (source : schéma
 *  `modelFields` de dsh-llm-pi-ai — `models` et `modelOverrides` partagent ces
 *  clés, seul l'emplacement de l'`id` change). */
export const WIRED_FIELDS = ['name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts', 'compat']

/** Tous les autres champs de la maquette : conservés, jamais écrits dans
 *  `settings.yaml` parce que le harnais ne les lit pas. */
export const ANNOTATION_FIELDS = [
  'textIn', 'vision', 'video', 'audioIn', 'textOut', 'tts', 'imageGen', 'videoGen',
  'tools', 'search', 's2s', 'reasoning', 'structured', 'temperature', 'type',
  'context', 'inputLimit', 'outputLimit',
  'costIn', 'costOut', 'cacheRead', 'cacheWrite',
  'family', 'knowledge', 'release', 'weights',
]

// La racine du harnais : `$DSH_HOME` quand il est posé (comme le reste de DSH),
// sinon `~/.dsh`. Le dossier du plugin est le même dans les deux cas.
const HOME = (() => {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return env
  try { return join(homedir(), '.dsh') } catch (e) { return join('/tmp', '.dsh') }
})()
const STORE_DIR = join(HOME, 'kybernos-models')
const ANNOTATIONS_FILE = join(STORE_DIR, 'catalog.json')
const MODELSDEV_CACHE = join(STORE_DIR, 'modelsdev.json')
const JOURNAL_FILE = join(STORE_DIR, 'journal.ndjson')
/** Taille au-delà de laquelle un index models.dev est considéré comme périmé. */
const MODELSDEV_TTL_MS = 6 * 60 * 60 * 1000

// ── Les notes externes : deux sources lues, aucune clé d'API ─────────────────
const SCORES_FILE = join(STORE_DIR, 'scores.json')
const SCORES_VERSION = 1
/** Les deux sources publient un instantané quotidien : 24 h de fraîcheur. */
const SCORES_TTL_MS = 24 * 60 * 60 * 1000
const AA_LB_URL = 'https://artificialanalysis.ai/leaderboards/models'
const BENCHLM_URL = 'https://benchlm.ai/data/models.json'
const BENCHLM_CATALOG_URL = 'https://benchlm.ai/data/benchmarks.json'

let bootedAt = null
let annotationsCache = null
let modelsDevCache = null
let modelsDevInflight = null
let scoresCache = null
let scoresInflight = null
let scoresJob = null

// ── JSON sûr : aucune écriture ne doit pouvoir casser le profil ──────────────
const readJson = (path, fallback) => {
  try {
    if (existsSync(path) !== true) return fallback
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed === null || parsed === undefined ? fallback : parsed
  } catch (e) { return fallback }
}

const writeJsonAtomic = (path, value) => {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = path + '.tmp-' + String(process.pid)
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(tmp, path)
}

const sendJson = (res, status, body) => {
  try {
    const txt = JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(txt)
  } catch (e) { try { res.end('{}') } catch (e2) { /* socket ferme */ } }
}

const readBody = (req) => new Promise((resolve) => {
  let raw = ''
  try {
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 2_000_000) raw = raw.slice(0, 2_000_000) })
    req.on('end', () => { try { resolve(raw.length === 0 ? {} : JSON.parse(raw)) } catch (e) { resolve(null) } })
    req.on('error', () => resolve(null))
  } catch (e) { resolve(null) }
})

const sameOrigin = (req) => {
  try {
    const origin = req.headers.origin
    if (origin === undefined || origin === null || origin === '') return true
    const host = req.headers.host
    return origin === 'http://' + host || origin === 'https://' + host
  } catch (e) { return false }
}

// ── Annotations : un seul fichier, fusion par clé `route/id` ─────────────────
const kbMaRead = () => {
  if (annotationsCache !== null) return annotationsCache
  const raw = readJson(ANNOTATIONS_FILE, {})
  const models = (raw !== null && typeof raw.models === 'object' && raw.models !== null) ? raw.models : {}
  const clean = {}
  for (const key of Object.keys(models)) {
    const entry = models[key]
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const fields = {}
    for (const k of Object.keys(entry)) {
      if (ANNOTATION_FIELDS.indexOf(k) < 0) continue
      const v = entry[k]
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') fields[k] = v
      else if (v === null) fields[k] = null
    }
    clean[key] = fields
  }
  annotationsCache = { version: MODEL_CATALOG_VERSION, models: clean }
  return annotationsCache
}

const kbMaWrite = (key, fields) => {
  const current = kbMaRead()
  const models = Object.assign({}, current.models)
  if (fields === null) delete models[key]
  else {
    const merged = Object.assign({}, models[key], fields)
    for (const k of Object.keys(merged)) {
      if (merged[k] === null || merged[k] === undefined || merged[k] === '') delete merged[k]
    }
    if (Object.keys(merged).length === 0) delete models[key]
    else models[key] = merged
  }
  const next = { version: MODEL_CATALOG_VERSION, models }
  writeJsonAtomic(ANNOTATIONS_FILE, next)
  annotationsCache = next
  return next
}

// ── Journal : une ligne JSON par tentative d'écriture (preuve locale) ───────
const kbJournalAppend = (entry) => {
  const line = Object.assign({ at: new Date().toISOString() }, entry)
  let text = ''
  try { text = readFileSync(JOURNAL_FILE, 'utf8') } catch (e) { text = '' }
  const rows = text.split('\n').filter((l) => l.trim().length > 0)
  rows.push(JSON.stringify(line))
  // On garde les 200 dernières lignes : un journal, pas une archive.
  const kept = rows.slice(Math.max(0, rows.length - 200))
  writeFileSync(JOURNAL_FILE, kept.join('\n') + '\n')
  return line
}

const kbJournalRead = () => {
  let text = ''
  try { text = readFileSync(JOURNAL_FILE, 'utf8') } catch (e) { return [] }
  const out = []
  for (const raw of text.split('\n')) {
    if (raw.trim().length === 0) continue
    try { out.push(JSON.parse(raw)) } catch (e) { /* ligne tronquee : ignoree */ }
  }
  return out
}

// ── Parked providers: "disabled" without deleting ───────────────────────────
// The engine has no per-provider off switch (measured on DSH 0.2.0-rc.2: no
// `enabled`/`disabled` in dsh-llm or dsh-llm-pi-ai). What it does have: a route
// exists only while its profile sits in `llm-pi-ai.providers`, and profiles are
// re-read on every request. So "disable" = move the profile out of the settings
// into this file, "enable" = put it back. While parked the provider is not
// routable and its models are gone from every picker: a hard block, no engine
// patch. The profile holds an env-var NAME (`apiKeyEnv`), never a key; it may
// hold `headers`, so the file is 0600 and only the same-origin page reads it.
export const PARKED_VERSION = 1
const PARKED_FILE = join(STORE_DIR, 'providers-parked.json')
const PARKED_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const PARKED_MAX_PROFILE_CHARS = 200000
const PARKED_MAX_MODELS = 5000

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Read the store; anything unreadable or malformed reads as "nothing parked". */
export const kbPkRead = (file = PARKED_FILE) => {
  const raw = readJson(file, {})
  const src = isPlainObject(raw) && isPlainObject(raw.providers) ? raw.providers : {}
  const providers = {}
  for (const slug of Object.keys(src)) {
    const e = src[slug]
    if (PARKED_SLUG.test(slug) !== true || !isPlainObject(e) || !isPlainObject(e.profile)) continue
    providers[slug] = {
      parkedAt: typeof e.parkedAt === 'string' ? e.parkedAt : null,
      models: Array.isArray(e.models) ? e.models.filter((x) => typeof x === 'string').slice(0, PARKED_MAX_MODELS) : [],
      profile: e.profile,
    }
  }
  return { version: PARKED_VERSION, providers }
}

const kbPkWrite = (file, providers) => {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + String(process.pid)
  writeFileSync(tmp, JSON.stringify({ version: PARKED_VERSION, providers }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file)
}

/** What the page may list without ever receiving a profile (headers can carry tokens). */
export const kbPkPublic = (store) => Object.keys(store.providers).map((slug) => {
  const e = store.providers[slug]
  return {
    slug,
    parkedAt: e.parkedAt,
    displayName: typeof e.profile.displayName === 'string' ? e.profile.displayName : null,
    models: e.models,
  }
})

/** Park a profile. Refuses a slug already parked: never overwrite a saved profile. */
export const kbPkPark = (slug, profile, models, file = PARKED_FILE) => {
  if (typeof slug !== 'string' || PARKED_SLUG.test(slug) !== true) return { ok: false, error: 'bad-slug' }
  if (!isPlainObject(profile)) return { ok: false, error: 'bad-profile' }
  let size = 0
  try { size = JSON.stringify(profile).length } catch (e) { return { ok: false, error: 'bad-profile' } }
  if (size > PARKED_MAX_PROFILE_CHARS) return { ok: false, error: 'profile-too-large' }
  const store = kbPkRead(file)
  if (store.providers[slug] !== undefined) return { ok: false, error: 'already-parked' }
  const ids = Array.isArray(models) ? models.filter((x) => typeof x === 'string' && x.length > 0 && x.length <= 300).slice(0, PARKED_MAX_MODELS) : []
  store.providers[slug] = { parkedAt: new Date().toISOString(), models: ids, profile }
  try { kbPkWrite(file, store.providers) } catch (e) { return { ok: false, error: 'write-failed', detail: String(e && e.message ? e.message : e) } }
  return { ok: true, slug }
}

/** The saved profile, left in place: the caller deletes it only after the settings write succeeded. */
export const kbPkTake = (slug, file = PARKED_FILE) => {
  if (typeof slug !== 'string' || PARKED_SLUG.test(slug) !== true) return { ok: false, error: 'bad-slug' }
  const e = kbPkRead(file).providers[slug]
  return e === undefined ? { ok: false, error: 'not-parked' } : { ok: true, slug, profile: e.profile, models: e.models }
}

export const kbPkForget = (slug, file = PARKED_FILE) => {
  if (typeof slug !== 'string' || PARKED_SLUG.test(slug) !== true) return { ok: false, error: 'bad-slug' }
  const store = kbPkRead(file)
  if (store.providers[slug] === undefined) return { ok: true, slug, removed: false }
  delete store.providers[slug]
  try { kbPkWrite(file, store.providers) } catch (e) { return { ok: false, error: 'write-failed', detail: String(e && e.message ? e.message : e) } }
  return { ok: true, slug, removed: true }
}

/** Strict same-origin (Origin, else Referer, required; host compared with the socket's real
 *  listening address, never the forgeable Host header). Same rule as `sameOriginStrict` in
 *  kybernos-plugin: plugin routes are served before DSH's own auth. */
export const kbSameOriginStrict = (req) => {
  try {
    const h = (req && req.headers) || {}
    const source = typeof h.origin === 'string' && h.origin !== '' ? h.origin : (typeof h.referer === 'string' && h.referer !== '' ? h.referer : null)
    if (source === null) return false
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const port = req.socket && typeof req.socket.localPort === 'number' ? ':' + req.socket.localPort : ''
    return (['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host))
  } catch (e) { return false }
}

/** Mount the four parked-provider routes on a webServer-like `{ register }`. */
export const kbPkMount = (register, file = PARKED_FILE) => {
  const guard = (req, res, method) => {
    if (req.method !== method) { sendJson(res, 405, { ok: false, error: 'method' }); return false }
    if (kbSameOriginStrict(req) !== true) { sendJson(res, 403, { ok: false, error: 'origin' }); return false }
    return true
  }
  const post = async (req, res) => {
    if (guard(req, res, 'POST') !== true) return null
    const body = await readBody(req)
    if (!isPlainObject(body)) { sendJson(res, 400, { ok: false, error: 'bad-json' }); return null }
    return body
  }
  register({ kind: 'exact', path: '/kybernos-models/providers/parked', handler: async (req, res) => {
    if (req.method !== 'GET') { sendJson(res, 405, { ok: false, error: 'method' }); return }
    // Listing carries no profile; a foreign Origin is still refused (DNS rebinding), no Origin passes.
    const o = req.headers && (req.headers.origin || req.headers.referer)
    if (o && kbSameOriginStrict(req) !== true) { sendJson(res, 403, { ok: false, error: 'origin' }); return }
    sendJson(res, 200, { ok: true, version: PARKED_VERSION, parked: kbPkPublic(kbPkRead(file)) })
  } })
  register({ kind: 'exact', path: '/kybernos-models/providers/park', handler: async (req, res) => {
    const b = await post(req, res)
    if (b === null) return
    const r = kbPkPark(b.slug, b.profile, b.models, file)
    sendJson(res, r.ok === true ? 200 : (r.error === 'already-parked' ? 409 : 400), r)
  } })
  register({ kind: 'exact', path: '/kybernos-models/providers/take', handler: async (req, res) => {
    const b = await post(req, res)
    if (b === null) return
    const r = kbPkTake(b.slug, file)
    sendJson(res, r.ok === true ? 200 : (r.error === 'not-parked' ? 404 : 400), r)
  } })
  register({ kind: 'exact', path: '/kybernos-models/providers/forget', handler: async (req, res) => {
    const b = await post(req, res)
    if (b === null) return
    const r = kbPkForget(b.slug, file)
    sendJson(res, r.ok === true ? 200 : (r.error === 'write-failed' ? 500 : 400), r)
  } })
}

// ── Index models.dev : un fetch pour tous, cache disque 6 h ──────────────────
/** Le cache disque vit sous la forme `{ at, data }` ; les fichiers écrits par
 *  une version antérieure portaient l'index à la racine. On lit les deux. */
const kbMdUnwrap = (disk) => {
  if (disk === null || typeof disk !== 'object') return null
  const payload = disk.data !== null && typeof disk.data === 'object' ? disk.data : (disk.byKey !== undefined ? disk : null)
  if (payload === null) return null
  // L'horodatage de l'enveloppe fait foi : c'est lui qui porte l'âge du cache.
  if (typeof payload.at !== 'number' && typeof disk.at === 'number') return Object.assign({}, payload, { at: disk.at })
  return payload
}
/** Lecture directe, hors service web du moteur : ce dernier tronque le corps à 100 000 caractères alors que l'index pèse ~4,7 Mo
 *  (JSON.parse échouait à 100000) et, surtout, il peut faire mourir tout le processus quand une connexion échoue sur-le-champ
 *  (pas de route, pare-feu : son dispatcher est fermé pendant qu'une seconde tentative est encore armée). Le `fetch` global rejette
 *  normalement. Le corps est lu par morceaux et coupé à `cap` octets : un tiers qui répond sans fin ne remplit pas la mémoire. */
const kbMdFetchDirect = async (url, cap = 12000000, extra = null) => {
  try {
    const control = new AbortController()
    const timer = setTimeout(() => { try { control.abort() } catch (e) { /* deja termine */ } }, 30000)
    try {
      const headers = Object.assign({ accept: 'application/json' }, extra === null ? {} : extra)
      const res = await fetch(url, { signal: control.signal, headers })
      if (res === null || res === undefined) return null
      if (res.ok === false) return null
      if (res.body !== null && res.body !== undefined && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader()
        const chunks = []
        let total = 0
        for (;;) {
          const part = await reader.read()
          if (part.done === true) break
          total += part.value.byteLength
          if (total > cap) { await reader.cancel().catch(() => {}); return null }
          chunks.push(part.value)
        }
        const text = Buffer.concat(chunks).toString('utf8')
        return text.length > 0 ? text : null
      }
      if (typeof res.text !== 'function') return null
      const text = await res.text()
      return typeof text === 'string' && text.length > 0 && text.length <= cap ? text : null
    } finally { clearTimeout(timer) }
  } catch (e) { return null }
}
const kbMdLoad = async (web, force) => {
  if (force !== true && modelsDevCache !== null && (Date.now() - modelsDevCache.at) < MODELSDEV_TTL_MS) return modelsDevCache
  if (force !== true) {
    // Sans cette lecture, la fenêtre de 6 h ne servait à rien et chaque session
    // retéléchargeait tout l'index.
    const disk = readJson(MODELSDEV_CACHE, null)
    const payload = kbMdUnwrap(disk)
    if (payload !== null && typeof disk.at === 'number' && (Date.now() - disk.at) < MODELSDEV_TTL_MS) {
      modelsDevCache = payload
      return payload
    }
  }
  if (modelsDevInflight !== null) return modelsDevInflight
  // `web` (le service du moteur) n'est plus appelé : voir kbMdFetchDirect. Le paramètre reste pour les appelants.
  modelsDevInflight = (async () => {
    try {
      // Pas de réseau : la lecture échoue, on sert le cache, même ancien — la route le dira « périmé » plutôt que de faire croire à
      // un index frais.
      const raw = await kbMdFetchDirect('https://models.dev/api.json')
      if (raw === null) throw new Error('reponse vide')
      const data = JSON.parse(raw)
      // Index par « provider/modele » ET par id nu : la maquette cherche par id,
      // les routes pi-ai nomment souvent « provider/modele ».
      const byKey = {}
      const byId = {}
      for (const provider of Object.keys(data)) {
        const models = (data[provider] !== null && typeof data[provider] === 'object' && data[provider].models !== null && typeof data[provider].models === 'object') ? data[provider].models : {}
        for (const id of Object.keys(models)) {
          const entry = models[id]
          if (entry === null || typeof entry !== 'object') continue
          const norm = kbMdNormalize(provider, id, entry)
          byKey[provider + '/' + id] = norm
          if (byId[id] === undefined) byId[id] = []
          byId[id].push(norm)
        }
      }
      const payload = { version: MODEL_CATALOG_VERSION, at: Date.now(), providers: Object.keys(data).length, byKey, byId }
      writeJsonAtomic(MODELSDEV_CACHE, { at: payload.at, data: payload })
      modelsDevCache = payload
      return payload
    } catch (e) {
      const payload = kbMdUnwrap(readJson(MODELSDEV_CACHE, null))
      modelsDevCache = payload
      return payload
    } finally { modelsDevInflight = null }
  })()
  return modelsDevInflight
}

/** Une entrée models.dev → les clés de la maquette (sans invention : seules les
 *  clés présentes dans la réponse sont posées). */
export const kbMdNormalize = (provider, id, entry) => {
  const modalities = (entry.modalities !== null && typeof entry.modalities === 'object') ? entry.modalities : {}
  const input = Array.isArray(modalities.input) ? modalities.input : []
  const output = Array.isArray(modalities.output) ? modalities.output : []
  const limit = (entry.limit !== null && typeof entry.limit === 'object') ? entry.limit : {}
  const cost = (entry.cost !== null && typeof entry.cost === 'object') ? entry.cost : {}
  const out = {
    provider, id,
    name: typeof entry.name === 'string' ? entry.name : id,
    textIn: input.indexOf('text') >= 0,
    vision: input.indexOf('image') >= 0,
    video: input.indexOf('video') >= 0,
    audioIn: input.indexOf('audio') >= 0,
    textOut: output.indexOf('text') >= 0,
    tts: output.indexOf('audio') >= 0,
    imageGen: output.indexOf('image') >= 0,
    videoGen: output.indexOf('video') >= 0,
    tools: entry.tool_call === true,
    structured: entry.structured_output === true,
    temperature: entry.temperature === true,
    reasoning: entry.reasoning === true,
    type: typeof entry.type === 'string' ? entry.type : '',
    context: limit.context === undefined ? '' : String(limit.context),
    outputLimit: limit.output === undefined ? '' : String(limit.output),
    costIn: cost.input === undefined ? '' : String(cost.input),
    costOut: cost.output === undefined ? '' : String(cost.output),
    cacheRead: cost.cache_read === undefined ? '' : String(cost.cache_read),
    cacheWrite: cost.cache_write === undefined ? '' : String(cost.cache_write),
    family: typeof entry.family === 'string' ? entry.family : '',
    knowledge: typeof entry.knowledge === 'string' ? entry.knowledge : '',
    release: typeof entry.release_date === 'string' ? entry.release_date : '',
    weights: entry.open_weights === true ? 'Open' : (entry.open_weights === false ? 'Closed' : ''),
  }
  const efforts = Array.isArray(entry.reasoning_options) ? entry.reasoning_options : []
  for (const option of efforts) {
    if (option !== null && typeof option === 'object' && option.type === 'effort' && Array.isArray(option.values)) {
      out.reasoningLevels = option.values.filter((v) => typeof v === 'string')
      break
    }
  }
  return out
}

const findModelsDev = (index, route, id) => {
  if (index === null || index === undefined) return null
  const byKey = index.byKey || {}
  const byId = index.byId || {}
  if (byKey[route + '/' + id] !== undefined) return byKey[route + '/' + id]
  if (byKey[id] !== undefined) return byKey[id]
  const list = byId[id]
  if (Array.isArray(list) && list.length > 0) return list[0]
  return null
}

// ── Notes externes : Artificial Analysis + BenchLM, par lecture de pages ─────
// Les deux sources publient l'équivalent d'un catalogue dans UNE page chacune :
//
//   · Artificial Analysis — le classement embarque, pour ses ~660 modèles, la
//     note d'intelligence ET les scores d'évaluation qui la composent (SciCode,
//     Terminal-Bench, HLE, GPQA, MMMU-Pro…), plus les prix et la vitesse. Aucune
//     clé n'est nécessaire : la clé n'ouvre que l'API, et l'API gratuite ne
//     donne pas plus que cette page.
//   · BenchLM — `/data/models.json` est un jeu publié qui porte ses propres
//     indices de catégorie (coding, agentic, knowledge…). Licence CC BY-NC 4.0 :
//     l'attribution est due, et l'usage commercial demande un accord.
//
// Ce sont deux provenances DISTINCTES : on ne les fond jamais en une note, et
// l'écart entre elles est une information — sur MiMo-V2.5-Pro, AA compte 21,3
// d'agentic là où BenchLM compte 58,9. Fusionner ces deux nombres fabriquerait
// une conclusion que ni l'une ni l'autre des sources ne soutient.

/** Normalisation pour rapprocher un modèle du harnais d'un slug de source. */
export const kbScoreNorm = (v) => String(v === null || v === undefined ? '' : v)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** Le nom sans ses qualificatifs : « X (Reasoning, Max Effort) » → « x ». */
const kbScoreBase = (v) => kbScoreNorm(String(v === null || v === undefined ? '' : v).replace(/\([^)]*\)/g, ' '))

/** Les morceaux RSC d'une page Next.js App Router, recollés. Les guillemets y
 *  sont échappés (`\"slug\"`) : chercher la clé en clair ne trouve rien alors
 *  que la donnée est à deux mètres — c'est le piège qui fait croire à tort que
 *  la page ne porte pas les scores. */
const kbScoreRsc = (html) => {
  const parts = []
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g
  let m
  while ((m = re.exec(html)) !== null) {
    try { parts.push(JSON.parse(m[1])) } catch (e) { /* morceau illisible */ }
  }
  return parts.join('')
}

/** Les objets d'une charge qui portent `"<ancre>": "…"` ET `"<num>": nombre`.
 *  L'objet englobant est délimité par équilibrage d'accolades. */
const kbScoreObjects = (blob, ancre, num) => {
  const out = []
  const re = new RegExp('"' + ancre + '":"([A-Za-z0-9][A-Za-z0-9.\\-_]{0,80})"', 'g')
  let m
  while ((m = re.exec(blob)) !== null) {
    const deb = blob.lastIndexOf('{', m.index)
    if (deb < 0) continue
    let prof = 0
    let fin = -1
    const plafond = Math.min(blob.length, deb + 8000)
    for (let i = deb; i < plafond; i += 1) {
      const c = blob[i]
      if (c === '{') prof += 1
      else if (c === '}') { prof -= 1; if (prof === 0) { fin = i; break } }
    }
    if (fin < 0) continue
    const txt = blob.slice(deb, fin + 1)
    if (txt.indexOf('"' + num + '":') < 0) continue
    try {
      const o = JSON.parse(txt)
      if (typeof o[ancre] === 'string' && typeof o[num] === 'number') out.push(o)
    } catch (e) { /* objet tronqué : ignoré */ }
  }
  return out
}

/** Ce qu'on garde d'un modèle du classement AA : la note, ses ingrédients, le
 *  prix, la vitesse. Une clé absente de la source reste absente ici. */
const AA_KEEP = [
  'slug', 'name', 'shortName', 'deprecated', 'isReasoning', 'isOpenWeights', 'paramClass', 'priceClass',
  'modelCreatorName', 'modelCreatorColor', 'contextWindowTokens',
  'intelligenceIndex', 'intelligenceIndexIsEstimated', 'intelligenceIndexCostPerTask',
  'scicode', 'terminalBench40', 'terminalBench21', 'terminalbenchHard', 'hle', 'gpqa', 'critpt', 'lcr',
  'tau2', 'tauBanking', 'mmmuPro', 'ifbench', 'gdpvalNormalized', 'analystAgent', 'apexAgents', 'itbenchSre',
  'omniscience', 'omniscienceAccuracy', 'omniscienceNonHallucination',
  'price1mInputTokens', 'price1mOutputTokens', 'cacheHitPrice', 'cacheWritePrice',
  'medianOutputTokensPerSecond', 'medianTimeToFirstTokenSeconds', 'medianTimeToFirstAnswerTokenSeconds',
  'medianEndToEndResponseTimeSeconds', 'medianReasoningTimeSeconds',
]
/** Les épreuves d'AA — celles pour lesquelles on cherche un intitulé lisible. */
const AA_EVAL_KEYS = [
  'scicode', 'terminalBench40', 'terminalBench21', 'terminalbenchHard', 'hle', 'gpqa', 'critpt', 'lcr',
  'tau2', 'tauBanking', 'mmmuPro', 'ifbench', 'gdpvalNormalized', 'analystAgent', 'apexAgents', 'itbenchSre', 'omniscience',
]
/** Les intitulés d'AA : le catalogue de BenchLM ne couvre pas ses clés (il écrit
 *  `terminalBench4` là où AA écrit `terminalBench40`), donc on les nomme ici. */
const AA_EVAL_LABELS = {
  scicode: 'SciCode', terminalBench40: 'Terminal-Bench 4.0', terminalBench21: 'Terminal-Bench 2.1',
  terminalbenchHard: 'Terminal-Bench Hard', hle: 'Humanity\u2019s Last Exam', gpqa: 'GPQA Diamond',
  critpt: 'CritPt', lcr: 'AA-LCR', tau2: '\u03c4\u00b2-bench', tauBanking: '\u03c4\u00b2-bench Banking',
  mmmuPro: 'MMMU-Pro', ifbench: 'IFBench', gdpvalNormalized: 'GDPval (normalis\u00e9)',
  analystAgent: 'Analyst Agent', apexAgents: 'APEX-Agents', itbenchSre: 'ITBench SRE', omniscience: 'Omniscience',
}
/** Un identifiant sans intitulé connu, rendu lisible plutôt que brut. */
const kbScorePretty = (k) => String(k)
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/([a-zA-Z])(\d)/g, '$1 $2')
  .replace(/^./, (c) => c.toUpperCase())
const kbScoreFromAa = (o) => {
  const out = {}
  for (const k of AA_KEEP) if (o[k] !== undefined) out[k] = o[k]
  return out
}

/** Ce qu'on garde d'un modèle BenchLM : ses indices de catégorie (dont coding et
 *  agentic), sa position, sa couverture, et les valeurs par benchmark qui les
 *  nourrissent. Le jeu publié ne porte PAS les sources ligne à ligne — celles-ci
 *  vivent sur la page HTML, et c'est écrit dans la note du panneau plutôt que
 *  laissé croire ici. */
const kbScoreFromBenchlm = (it) => {
  const scores = (it.scores !== null && typeof it.scores === 'object') ? it.scores : {}
  const ranking = (it.ranking !== null && typeof it.ranking === 'object') ? it.ranking : {}
  const bm = (it.benchmarks !== null && typeof it.benchmarks === 'object') ? it.benchmarks : {}
  const benchmarks = {}
  for (const cat of Object.keys(bm)) {
    const liste = bm[cat]
    if (liste === null || typeof liste !== 'object' || Array.isArray(liste)) continue
    const vals = {}
    for (const k of Object.keys(liste)) if (typeof liste[k] === 'number') vals[k] = liste[k]
    if (Object.keys(vals).length > 0) benchmarks[cat] = vals
  }
  return {
    slug: it.slug, name: it.model === undefined ? null : it.model,
    creator: it.creator === undefined ? null : it.creator,
    releaseDate: it.releaseDate === undefined ? null : it.releaseDate,
    contextWindow: it.contextWindow === undefined ? null : it.contextWindow,
    displayScore: it.displayScore === undefined ? null : it.displayScore,
    provisionalDisplayScore: it.provisionalDisplayScore === undefined ? null : it.provisionalDisplayScore,
    verifiedDisplayScore: scores.verifiedDisplayScore === undefined ? null : scores.verifiedDisplayScore,
    categories: scores.displayCategoryScores === undefined ? null : scores.displayCategoryScores,
    verifiedCategories: scores.verifiedDisplayCategoryScores === undefined ? null : scores.verifiedDisplayCategoryScores,
    rankingEligible: it.rankingEligible === true,
    overallRank: it.overallRank === undefined ? null : it.overallRank,
    rankingMode: it.publicRankingMode === undefined ? null : it.publicRankingMode,
    categoryRankingEligible: ranking.categoryRankingEligible === undefined ? null : ranking.categoryRankingEligible,
    coverage: it.coverage === undefined ? null : it.coverage,
    url: it.url === undefined ? null : it.url,
    benchmarks,
  }
}

const kbScoreUa = { 'user-agent': 'Mozilla/5.0 (Kybernos model panel; releve ponctuel)', accept: 'text/html,application/json' }

const kbScoreLoadAa = async () => {
  const html = await kbMdFetchDirect(AA_LB_URL, 12000000, kbScoreUa)
  if (html === null) return null
  const objs = kbScoreObjects(kbScoreRsc(html), 'slug', 'intelligenceIndex')
  const bySlug = {}
  for (const o of objs) {
    // Le même slug apparaît dans plusieurs objets : le plus riche gagne.
    const precedent = bySlug[o.slug]
    if (precedent === undefined || Object.keys(o).length > Object.keys(precedent).length) bySlug[o.slug] = kbScoreFromAa(o)
  }
  return Object.keys(bySlug).length === 0 ? null : bySlug
}

const kbScoreLoadBenchlm = async () => {
  const raw = await kbMdFetchDirect(BENCHLM_URL, 12000000, kbScoreUa)
  if (raw === null) return null
  let data = null
  try { data = JSON.parse(raw) } catch (e) { return null }
  const items = (data !== null && Array.isArray(data.items)) ? data.items : []
  const bySlug = {}
  for (const it of items) if (it !== null && typeof it === 'object' && typeof it.slug === 'string') bySlug[it.slug] = kbScoreFromBenchlm(it)
  return Object.keys(bySlug).length === 0 ? null : bySlug
}

/** Le catalogue des épreuves : il donne un nom lisible à chaque clé employée par
 *  les modèles (`terminalBench21` → « Terminal-Bench 2.1 »), sans quoi la fiche
 *  afficherait des identifiants internes à la place d'un intitulé. */
const kbScoreLoadBenchlmCatalog = async () => {
  const raw = await kbMdFetchDirect(BENCHLM_CATALOG_URL, 12000000, kbScoreUa)
  if (raw === null) return null
  let data = null
  try { data = JSON.parse(raw) } catch (e) { return null }
  const items = (data !== null && (Array.isArray(data.items) ? data.items : (Array.isArray(data.benchmarks) ? data.benchmarks : null)))
  if (items === null) return null
  const byKey = {}
  for (const it of items) {
    if (it === null || typeof it !== 'object') continue
    const cle = typeof it.benchmarkKey === 'string' ? it.benchmarkKey : (typeof it.key === 'string' ? it.key : null)
    if (cle === null) continue
    byKey[cle] = {
      name: it.name === undefined ? null : it.name,
      category: it.categoryLabel === undefined ? (it.category === undefined ? null : it.category) : it.categoryLabel,
      paperUrl: it.paperUrl === undefined ? null : it.paperUrl,
      year: it.year === undefined ? null : it.year,
      weight: it.weight === undefined ? null : it.weight,
    }
  }
  return Object.keys(byKey).length === 0 ? null : byKey
}

/** Rafraîchit les deux sources, en arrière-plan. Une source injoignable ne doit
 *  JAMAIS effacer celle qu'on avait déjà : on garde l'ancienne et le statut le
 *  dit, plutôt que de rendre l'écran vide sur une coupure réseau. */
const kbScoresRefresh = async () => {
  if (scoresInflight !== null) return scoresInflight
  scoresJob = { running: true, startedAt: Date.now(), finishedAt: null, error: null, sources: {} }
  scoresInflight = (async () => {
    const precedent = readJson(SCORES_FILE, null)
    let aa = null
    let benchlm = null
    let catalogue = null
    try { aa = await kbScoreLoadAa() } catch (e) { aa = null }
    try { benchlm = await kbScoreLoadBenchlm() } catch (e) { benchlm = null }
    try { catalogue = await kbScoreLoadBenchlmCatalog() } catch (e) { catalogue = null }
    const precAa = (precedent !== null && precedent.aa !== null && typeof precedent.aa === 'object') ? precedent.aa : {}
    const precBl = (precedent !== null && precedent.benchlm !== null && typeof precedent.benchlm === 'object') ? precedent.benchlm : {}
    const precCat = (precedent !== null && precedent.catalogue !== null && typeof precedent.catalogue === 'object') ? precedent.catalogue : {}
    const precSrc = (precedent !== null && precedent.sources !== null && typeof precedent.sources === 'object') ? precedent.sources : {}
    scoresJob.sources.aa = aa === null ? 0 : Object.keys(aa).length
    scoresJob.sources.benchlm = benchlm === null ? 0 : Object.keys(benchlm).length
    scoresJob.sources.catalogue = catalogue === null ? 0 : Object.keys(catalogue).length
    if (aa === null) scoresJob.sources.aaError = 'artificialanalysis-injoignable'
    if (benchlm === null) scoresJob.sources.benchlmError = 'benchlm-injoignable'
    const next = {
      version: SCORES_VERSION,
      at: Date.now(),
      sources: {
        aa: aa === null ? (precSrc.aa === undefined ? null : precSrc.aa) : { at: Date.now(), count: Object.keys(aa).length, url: AA_LB_URL, source: 'Artificial Analysis' },
        benchlm: benchlm === null ? (precSrc.benchlm === undefined ? null : precSrc.benchlm) : { at: Date.now(), count: Object.keys(benchlm).length, url: BENCHLM_URL, source: 'BenchLM', licence: 'CC BY-NC 4.0' },
      },
      aa: aa === null ? precAa : aa,
      benchlm: benchlm === null ? precBl : benchlm,
      catalogue: catalogue === null ? precCat : catalogue,
    }
    writeJsonAtomic(SCORES_FILE, next)
    scoresCache = next
    scoresJob.running = false
    scoresJob.finishedAt = Date.now()
    if (aa === null && benchlm === null) scoresJob.error = 'aucune-source-injoignable'
    return next
  })()
  try { return await scoresInflight } finally { scoresInflight = null }
}

/** L'instantané sur disque, relu si le cache mémoire est froid. */
const kbScoresRead = (force) => {
  if (force !== true && scoresCache !== null && typeof scoresCache.at === 'number' && (Date.now() - scoresCache.at) < SCORES_TTL_MS) return scoresCache
  const disk = readJson(SCORES_FILE, null)
  if (disk !== null && typeof disk === 'object' && typeof disk.at === 'number') {
    scoresCache = disk
    if (force !== true && (Date.now() - disk.at) < SCORES_TTL_MS) return disk
  }
  return scoresCache
}

/** Un identifiant à variante (`glm-5.2:free`, `minimax-m3:nitro`) désigne le même
 *  modèle servi autrement : les catalogues ne connaissent que le nom de base, et
 *  sans ce retrait deux modèles sur cinq ne se rapprochaient pas. */
const kbScoreSansVariante = (v) => String(v === null || v === undefined ? '' : v).replace(/:[a-zA-Z0-9._-]+$/, '')

/** Les règles de rapprochement, de la plus sûre à la plus faible.
 *
 *  Le « nom court » d'AA est une ABRÉVIATION d'affichage, pas un nom : elle perd
 *  le mot qui distingue (« Llama 3.1 8B Instruct » s'y écrit « Llama 3.1 8B »).
 *  Il n'est donc employé QUE sur les identifiants, jamais sur un nom affiché —
 *  sans quoi « Llama 3.1 8B Instant » recevait les notes du modèle « Instruct »,
 *  c'est-à-dire une valeur fausse présentée comme un fait. Et chaque règle doit
 *  désigner un seul modèle : une hésitation qui se tait serait pire qu'une
 *  absence, laquelle est visible. */
const kbMatchIn = (catalogue, nameKey, cibles, bases, ciblesId) => {
  const etapes = [
    ['slug', (slug) => cibles.indexOf(kbScoreNorm(slug)) >= 0],
    ['nom', (slug, e) => cibles.indexOf(kbScoreNorm(e[nameKey])) >= 0],
    ['nom-sans-qualificatif', (slug, e) => bases.indexOf(kbScoreBase(e[nameKey])) >= 0],
    ['id-court', (slug, e) => typeof e.shortName === 'string' && e.shortName.length > 0 && ciblesId.indexOf(kbScoreNorm(e.shortName)) >= 0],
  ]
  for (const etape of etapes) {
    const trouve = []
    for (const slug of Object.keys(catalogue)) {
      const e = catalogue[slug]
      if (e === null || typeof e !== 'object') continue
      if (etape[1](slug, e) === true) trouve.push(slug)
    }
    if (trouve.length === 1) return { slug: trouve[0], method: etape[0], entry: catalogue[trouve[0]] }
    if (trouve.length > 1) return null
  }
  return null
}

/** Les mêmes mots dans un autre ordre désignent le même modèle : AA écrit
 *  « Claude 4.5 Sonnet », le harnais « Claude Sonnet 4.5 ». Deux candidats
 *  possibles ⇒ on ne choisit PAS : une hésitation qui se tait serait pire qu'une
 *  absence, qui elle est visible. */
const kbScoreJetons = (v) => kbScoreBase(v).split('-').filter((x) => x.length > 0).sort().join('-')
const kbMatchEnDesordre = (catalogue, nameKey, bases) => {
  const jetons = bases.map(kbScoreJetons).filter((x) => x.length > 0)
  if (jetons.length === 0) return null
  const trouve = []
  for (const slug of Object.keys(catalogue)) {
    const e = catalogue[slug]
    if (e === null || e === undefined) continue
    if (jetons.indexOf(kbScoreJetons(e[nameKey])) >= 0) trouve.push(slug)
  }
  return trouve.length === 1 ? { slug: trouve[0], method: 'nom-en-desordre', entry: catalogue[trouve[0]] } : null
}

/** Rapproche un modèle du harnais des deux catalogues. La méthode de
 *  rapprochement est rendue avec la donnée : une correspondance approximative
 *  qui se tait est exactement ce qu'il ne faut pas construire. */
export const kbScoreMatch = (snapshot, route, id, name) => {
  const aa = (snapshot !== null && snapshot !== undefined && snapshot.aa !== null && typeof snapshot.aa === 'object') ? snapshot.aa : {}
  const bl = (snapshot !== null && snapshot !== undefined && snapshot.benchlm !== null && typeof snapshot.benchlm === 'object') ? snapshot.benchlm : {}
  const seg = String(id === undefined || id === null ? '' : id).split('/').filter((s) => s.length > 0)
  const dernier = seg.length > 0 ? seg[seg.length - 1] : String(id === undefined || id === null ? '' : id)
  const brut = [dernier, id]
  const brutId = [dernier, id]
  if (typeof name === 'string' && name.length > 0) brut.push(name)
  const cibles = []
  const bases = []
  const ciblesId = []
  for (const v of brut) {
    cibles.push(kbScoreNorm(v))
    bases.push(kbScoreBase(v))
    const sv = kbScoreSansVariante(v)
    if (sv !== v) { cibles.push(kbScoreNorm(sv)); bases.push(kbScoreBase(sv)) }
  }
  for (const v of brutId) {
    ciblesId.push(kbScoreNorm(v))
    const sv = kbScoreSansVariante(v)
    if (sv !== v) ciblesId.push(kbScoreNorm(sv))
  }
  return {
    aa: Object.keys(aa).length === 0 ? null : (kbMatchIn(aa, 'name', cibles, bases, ciblesId) || kbMatchEnDesordre(aa, 'name', bases)),
    benchlm: Object.keys(bl).length === 0 ? null : (kbMatchIn(bl, 'model', cibles, bases, ciblesId) || kbMatchEnDesordre(bl, 'model', bases)),
  }
}

/** Les intitulés lisibles des épreuves employées par CE modèle, et rien d'autre :
 *  la fiche n'a pas besoin des 447 épreuves du catalogue pour en afficher dix. */
const kbScoreLabels = (snapshot, match) => {
  const cat = (snapshot !== null && snapshot !== undefined && snapshot.catalogue !== null && typeof snapshot.catalogue === 'object') ? snapshot.catalogue : {}
  const out = {}
  const aa = match === null || match === undefined ? null : match.aa
  if (aa !== null && aa !== undefined) {
    for (const k of AA_EVAL_KEYS) {
      if (aa.entry[k] === undefined || aa.entry[k] === null) continue
      const c = cat[k]
      out[k] = {
        name: AA_EVAL_LABELS[k] !== undefined ? AA_EVAL_LABELS[k] : (c !== undefined && c.name !== null ? c.name : kbScorePretty(k)),
        category: c === undefined || c.category === null ? 'Artificial Analysis' : c.category,
        year: c === undefined ? null : c.year,
      }
    }
  }
  const bl = match === null || match === undefined ? null : match.benchlm
  if (bl !== null && bl !== undefined) {
    const bm = bl.entry.benchmarks !== null && typeof bl.entry.benchmarks === 'object' ? bl.entry.benchmarks : {}
    for (const c of Object.keys(bm)) {
      for (const k of Object.keys(bm[c])) {
        const e = cat[k]
        out[k] = {
          name: e !== undefined && e.name !== null ? e.name : kbScorePretty(k),
          category: e === undefined || e.category === null ? c : e.category,
          year: e === undefined ? null : e.year,
        }
      }
    }
  }
  return out
}

export function apply(ctx) {
  bootedAt = new Date().toISOString()
  try {
    ctx.inject(['webServer'], (hostCtx) => {
      const webServer = hostCtx.get('webServer')
      const web = hostCtx.get('web')

      // Diagnostic : prouve que la moitié host tourne et expose le contrat.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/status', handler: async (req, res) => {
        const annotations = kbMaRead()
        const snap = kbScoresRead(false)
        sendJson(res, 200, {
          ok: true,
          version: MODEL_CATALOG_VERSION,
          bootedAt,
          mode: 'cable',
          wired: WIRED_FIELDS,
          annotation: ANNOTATION_FIELDS,
          store: { dir: STORE_DIR, annotations: Object.keys(annotations.models).length, annotationsFile: ANNOTATIONS_FILE },
          modelsDev: { cached: modelsDevCache === null ? 0 : Object.keys(modelsDevCache.byKey || {}).length, file: MODELSDEV_CACHE },
          scores: {
            file: SCORES_FILE,
            at: snap === null ? null : snap.at,
            aa: snap === null ? 0 : Object.keys(snap.aa || {}).length,
            benchlm: snap === null ? 0 : Object.keys(snap.benchlm || {}).length,
            running: scoresJob !== null && scoresJob.running === true,
          },
        })
      }}), 'kybernos-models: statut')

      // Lecture des annotations (une entrée par « route/id »).
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/annotations', handler: async (req, res) => {
        sendJson(res, 200, { ok: true, version: MODEL_CATALOG_VERSION, models: kbMaRead().models })
      }}), 'kybernos-models: annotations (lecture)')

      // Écriture : un patch de champs d'annotation pour un modèle. `null` purge
      // l'entrée entière (c'est le chemin du revert global).
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/annotations/save', handler: async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        if (sameOrigin(req) !== true) { sendJson(res, 403, { ok: false, error: 'origin' }); return }
        const body = await readBody(req)
        if (body === null || typeof body !== 'object') { sendJson(res, 400, { ok: false, error: 'bad-json' }); return }
        const key = typeof body.key === 'string' ? body.key : ''
        const slash = key.indexOf('/')
        if (key.length === 0 || key.length > 300 || slash <= 0 || slash === key.length - 1) { sendJson(res, 400, { ok: false, error: 'bad-key' }); return }
        const fields = body.fields
        if (fields !== null && (typeof fields !== 'object' || Array.isArray(fields))) { sendJson(res, 400, { ok: false, error: 'bad-fields' }); return }
        try {
          const next = kbMaWrite(key, fields)
          sendJson(res, 200, { ok: true, version: MODEL_CATALOG_VERSION, key, fields: next.models[key] || null, count: Object.keys(next.models).length })
        } catch (e) {
          sendJson(res, 500, { ok: false, error: 'write-failed', detail: String(e && e.message ? e.message : e) })
        }
      }}), 'kybernos-models: annotations (ecriture)')

      // Parked ("disabled") providers: list, park, take, forget.
      kbPkMount((route) => hostCtx.effect(() => webServer.register(route), 'kybernos-models: ' + route.path))

      // Journal des écritures : chaque tentative du panneau (champ réel ou
      // annotation) y laisse une ligne, avec la réponse du harnais. C'est la
      // preuve lisible de ce qui s'est passé — et ça ne quitte pas la machine.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/journal', handler: async (req, res) => {
        const url = new URL('http://x' + (req.url || '/'))
        if (req.method === 'GET') {
          const limit = Number(url.searchParams.get('limit') || '60')
          const lines = kbJournalRead()
          sendJson(res, 200, { ok: true, version: MODEL_CATALOG_VERSION, file: JOURNAL_FILE, count: lines.length, lines: lines.slice(Math.max(0, lines.length - limit)) })
          return
        }
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        if (sameOrigin(req) !== true) { sendJson(res, 403, { ok: false, error: 'origin' }); return }
        const body = await readBody(req)
        if (body === null || typeof body !== 'object') { sendJson(res, 400, { ok: false, error: 'bad-json' }); return }
        try {
          const line = kbJournalAppend(body)
          sendJson(res, 200, { ok: true, version: MODEL_CATALOG_VERSION, line })
        } catch (e) {
          sendJson(res, 500, { ok: false, error: 'write-failed', detail: String(e && e.message ? e.message : e) })
        }
      }}), 'kybernos-models: journal des ecritures')

      // Préremplissage : l'index models.dev, un fetch pour tout le monde.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/modelsdev', handler: async (req, res) => {
        const url = new URL('http://x' + (req.url || '/'))
        const route = url.searchParams.get('route') || ''
        const id = url.searchParams.get('id') || ''
        const force = url.searchParams.get('force') === '1'
        const index = await kbMdLoad(web, force)
        if (index === null) { sendJson(res, 200, { ok: false, error: 'modelsdev-unavailable' }); return }
        // `stale` : l'index vient d'un cache de plus de 6 h (poste hors ligne).
        const stale = typeof index.at === 'number' ? (Date.now() - index.at) >= MODELSDEV_TTL_MS : false
        if (id.length === 0) {
          sendJson(res, 200, { ok: true, version: MODEL_CATALOG_VERSION, at: index.at, stale, providers: index.providers || 0, entries: Object.keys(index.byKey || {}).length })
          return
        }
        const hit = findModelsDev(index, route, id)
        sendJson(res, 200, { ok: true, version: MODEL_CATALOG_VERSION, at: index.at, stale, id, route, match: hit === null ? null : hit })
      }}), 'kybernos-models: index models.dev')

      // ── Catalogue de fournisseurs (models.dev) et leurs logos ─────────────
      // Générés par `scripts/build-provider-catalog.mjs` : un fichier JSON et un
      // SVG nettoyé par fournisseur, lus sur disque — aucun appel réseau.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/providers', handler: async (req, res) => {
        try {
          const txt = readFileSync(join(pluginDir, 'provider-catalog.json'), 'utf8')
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' })
          res.end(txt)
        } catch (e) { sendJson(res, 200, { ok: false, error: 'catalog-unavailable' }) }
      }}), 'kybernos-models: catalogue de fournisseurs')

      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/logo', handler: async (req, res) => {
        const id = new URL('http://x' + (req.url || '/')).searchParams.get('id') || ''
        const fichier = join(pluginDir, 'logos', id + '.svg')
        if (/^[a-z0-9][a-z0-9._-]{0,60}$/.test(id) !== true || id.includes('..') || existsSync(fichier) !== true) {
          try { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found') } catch (e) { /* socket fermé */ }
          return
        }
        try {
          res.writeHead(200, {
            'content-type': 'image/svg+xml; charset=utf-8',
            'cache-control': 'public, max-age=86400',
            'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
          })
          res.end(readFileSync(fichier))
        } catch (e) { try { res.end() } catch (e2) { /* socket fermé */ } }
      }}), 'kybernos-models: logos de fournisseurs')

      // ── Notes externes : lues, servies, jamais fusionnées ────────────────
      // La provenance voyage avec la donnée : `method` dit comment le modèle a
      // été rapproché, `sources` dit quand chaque catalogue a été lu.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/scores', handler: async (req, res) => {
        const url = new URL('http://x' + (req.url || '/'))
        const key = url.searchParams.get('key') || ''
        const name = url.searchParams.get('name') || ''
        const force = url.searchParams.get('force') === '1'
        const snapshot = kbScoresRead(force)
        const slash = key.indexOf('/')
        const route = slash > 0 ? key.slice(0, slash) : ''
        const id = slash > 0 ? key.slice(slash + 1) : ''
        const stale = snapshot === null || typeof snapshot.at !== 'number' ? true : (Date.now() - snapshot.at) >= SCORES_TTL_MS
        const match = snapshot === null ? { aa: null, benchlm: null } : kbScoreMatch(snapshot, route, id, name)
        sendJson(res, 200, {
          ok: true, version: SCORES_VERSION, key, at: snapshot === null ? null : snapshot.at, stale,
          running: scoresJob !== null && scoresJob.running === true,
          sources: snapshot === null ? null : snapshot.sources,
          labels: snapshot === null ? {} : kbScoreLabels(snapshot, match),
          aa: match.aa, benchlm: match.benchlm,
        })
      }}), 'kybernos-models: notes externes (lecture)')

      // Le déclenchement : la réponse part TOUT DE SUITE, le scrape continue.
      // Un scrape à jour ne se relance pas — il coûte ~4 Mo et deux requêtes.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/scores/sync', handler: async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        if (sameOrigin(req) !== true) { sendJson(res, 403, { ok: false, error: 'origin' }); return }
        const body = await readBody(req)
        const force = body !== null && typeof body === 'object' && body.force === true
        if (scoresInflight !== null) { sendJson(res, 200, { ok: true, started: false, running: true }); return }
        const snapshot = kbScoresRead(false)
        if (force !== true && snapshot !== null && typeof snapshot.at === 'number' && (Date.now() - snapshot.at) < SCORES_TTL_MS) {
          sendJson(res, 200, { ok: true, started: false, running: false, at: snapshot.at, frais: true })
          return
        }
        kbScoresRefresh().catch(() => { /* le statut porte l'erreur */ })
        sendJson(res, 200, { ok: true, started: true, running: true })
      }}), 'kybernos-models: notes externes (rafraichissement)')

      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/scores/status', handler: async (req, res) => {
        const snapshot = kbScoresRead(false)
        sendJson(res, 200, {
          ok: true, version: SCORES_VERSION,
          at: snapshot === null ? null : snapshot.at,
          sources: snapshot === null ? null : snapshot.sources,
          job: scoresJob,
        })
      }}), 'kybernos-models: notes externes (statut)')
    })
  } catch (kbBootError) {
    try { console.error('[kybernos-models] montage des routes impossible', kbBootError) } catch (e2) { /* console indisponible */ }
  }
}

export { STORE_DIR, ANNOTATIONS_FILE, MODELSDEV_CACHE, SCORES_FILE, JOURNAL_FILE, pluginDir, kbScoresRefresh, kbScoresRead }
