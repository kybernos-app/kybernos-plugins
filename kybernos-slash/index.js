// ── Plugin hôte « kybernos-slash » ──────────────────────────────────────────
// Rend RÉELLES les « commandes slash & actions » : une route CRUD que le client
// lit et que le skill `slash-msgaction-creator` écrit.
//
//   GET  /kybernos/slash/entries   → { ok, version, path, entries }
//   POST /kybernos/slash/entries   → upsert / delete / replace, réponse { ok, ... }
//   GET  /kybernos/slash/status    → diagnostic (chemin, existence, nombre)
//
// Stockage : UN SEUL fichier, `$DSH_HOME/kybernos-slash/entries.json` — un
// tableau JSON d'entrées, fusion par `id`. C'est exactement le repli que le
// skill utilise quand la route répond 404 : les deux chemins mènent au même
// fichier, donc brancher la route ne perd rien de ce qui a déjà été écrit.
//
// La sémantique (conditions, visibilité, requis, rendu, normalisation des
// modèles hérités) n'est PAS réécrite ici : elle vient de `./model.js`, le cœur
// sans dépendance testé par `scripts/test-kybernos-slash-model.mjs`.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL_VERSION, normalize, runOf, hasForm, visibleFields, validate, render } from './model.js'

const pluginDir = dirname(fileURLToPath(import.meta.url))

// ── HTTP : mêmes gardes que kybernos-skills/index.js (méthode, puis origine) ──
const sendJson = (res, status, payload) => {
  try {
    const body = JSON.stringify(payload === undefined ? null : payload)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  } catch (e) { try { res.writeHead(500); res.end('{}') } catch (e2) { /* socket ferme */ } }
}

const sameOrigin = (req) => {
  try {
    const origin = req.headers && typeof req.headers.origin === 'string' ? req.headers.origin : null
    const hostHeader = req.headers && typeof req.headers.host === 'string' ? req.headers.host : null
    if (origin === null || hostHeader === null) return true
    const u = new URL(origin)
    return u.host === hostHeader
  } catch (e) { return false }
}

const readJsonBody = async (req, maxBytes) => {
  const cap = typeof maxBytes === 'number' ? maxBytes : 262144
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > cap) throw new Error('corps de requete trop volumineux')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(text)
}

const queryParam = (req, key) => {
  try {
    const raw = str(req.url) !== null ? String(req.url) : ''
    const q = raw.indexOf('?')
    if (q < 0) return null
    const parts = raw.slice(q + 1).split('&')
    for (const p of parts) {
      const eq = p.indexOf('=')
      const k = eq < 0 ? p : p.slice(0, eq)
      if (decodeURIComponent(k) !== key) continue
      const v = eq < 0 ? '' : decodeURIComponent(p.slice(eq + 1).replace(/\+/g, ' '))
      return v === '' ? null : v
    }
  } catch (e) { return null }
  return null
}

const str = (v) => (typeof v === 'string' && v !== '' ? v : null)

// ── Où vit le magasin ───────────────────────────────────────────────────────
// `DSH_HOME` peut déplacer le foyer ; `KYBERNOS_SLASH_STORE` n'existe que pour
// que le harnais puisse viser un fichier temporaire sans toucher au vrai.
export function dshHome() {
  const env = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : null
  return env !== null ? env : join(homedir(), '.dsh')
}

export function storePath() {
  const forced = typeof process.env.KYBERNOS_SLASH_STORE === 'string' && process.env.KYBERNOS_SLASH_STORE !== ''
    ? process.env.KYBERNOS_SLASH_STORE
    : null
  return forced !== null ? forced : join(dshHome(), 'kybernos-slash', 'entries.json')
}

// ── Lecture / écriture ──────────────────────────────────────────────────────
/** Le contenu du magasin, toujours un tableau. Illisible ou absent → `[]`. */
export function readStore(path) {
  const p = path !== undefined && path !== null ? path : storePath()
  let raw = null
  try { raw = readFileSync(p, 'utf8') } catch (e) { return [] }
  try {
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch (e) { return [] }
}

/** Écriture atomique : fichier temporaire puis renommage, jamais de JSON tronqué. */
export function writeStore(list, path) {
  const p = path !== undefined && path !== null ? path : storePath()
  const dir = dirname(p)
  try { mkdirSync(dir, { recursive: true }) } catch (e) { /* existe déjà */ }
  const tmp = p + '.tmp-' + String(process.pid)
  writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n', 'utf8')
  renameSync(tmp, p)
  return p
}

// ── Canonicalisation (validation par model.js) ──────────────────────────────
const isI18n = (v) => v !== null && typeof v === 'object' && Array.isArray(v) === false
const asArray = (v) => (Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v]))

/**
 * Valide et canonicalise une entrée brute SANS perdre l'i18n.
 *
 * `model.js#normalize` fait le vrai travail : il accepte `slug`/`cmd`/`name`,
 * les modèles hérités (`visibleWhen`, `hiddenIf`, `data.prompt_message`), et
 * dérive `id`, `run`, les champs et le gabarit. Mais il APLATIT les libellés
 * `{fr,en}` en une chaîne (SPEC règle 9 : les trois formes sont admises et le
 * client choisit sa langue). On ré-attache donc l'objet localisé quand la
 * source en portait un.
 */
export function canonicalize(raw, kind, opts) {
  const src = isI18n(raw) ? raw : {}
  const k = kind !== undefined ? kind : (src.kind === 'action' ? 'action' : 'slash')
  // Une ACTION de la maquette porte son gabarit dans `submit` (avec `{message}`),
  // là où une commande le porte dans `template`. `model.js` ne connaît que
  // `template` : sans cette passerelle, le corps d'une action se perdait en
  // silence — `normalize` ne lève pas, il rend une chaîne vide.
  const withTemplate = (src.template === undefined && src.submit !== undefined)
    ? Object.assign({}, src, { template: src.submit })
    : src
  const base = normalize(withTemplate, k, opts)
  if (isI18n(src.label)) base.label = src.label
  if (isI18n(src.description)) base.description = src.description
  const srcFields = asArray(src.fields !== undefined ? src.fields : (isI18n(src.data) ? src.data.fields : []))
  base.fields = (base.fields || []).map((f, i) => {
    const rf = isI18n(srcFields[i]) ? srcFields[i] : {}
    const out = Object.assign({}, f)
    if (isI18n(rf.label)) out.label = rf.label
    if (isI18n(rf.placeholder)) out.placeholder = rf.placeholder
    if (Array.isArray(rf.options) && Array.isArray(f.options) && rf.options.length === f.options.length) {
      out.options = f.options.map((o, j) => (isI18n(rf.options[j]) && isI18n(rf.options[j].label)
        ? Object.assign({}, o, { label: rf.options[j].label })
        : o))
    }
    if (rf.requireIf !== undefined) out.requireIf = rf.requireIf
    return out
  })
  // `name` est l'alias historique du `slug` (maquette, kybernos d'origine) :
  // on l'expose pour que le client n'ait pas à choisir entre les deux.
  base.name = base.slug
  base.run = runOf(base)
  base.version = MODEL_VERSION
  return base
}

/** L'identité d'une entrée, quelle que soit la forme reçue. */
export function idOf(entry) {
  if (isI18n(entry) === false) return null
  const raw = entry.id !== undefined ? entry.id : (entry.slug !== undefined ? entry.slug : entry.name)
  if (raw === undefined || raw === null) return null
  const id = String(raw).replace(/^\/+/, '').trim()
  return id === '' ? null : id
}

/** Ordre d'affichage : `order` croissant, puis `slug` — stable et prévisible. */
export const compareEntries = (a, b) => {
  const oa = Number.isFinite(a.order) ? a.order : 0
  const ob = Number.isFinite(b.order) ? b.order : 0
  if (oa !== ob) return oa - ob
  return String(a.name || a.slug || a.id || '').localeCompare(String(b.name || b.slug || b.id || ''))
}

/**
 * Fusion par `id` : une entrée reçue REMPLACE celle du même id, elle ne
 * duplique jamais. Renvoie `{ entries, added, updated }`.
 */
export function mergeEntries(existing, incoming) {
  const list = asArray(existing).slice()
  const byId = new Map()
  list.forEach((e) => { const id = idOf(e); if (id !== null) byId.set(id, e) })
  let added = 0
  let updated = 0
  asArray(incoming).forEach((e) => {
    const id = idOf(e)
    if (id === null) return
    const next = Object.assign({}, e, { id })
    if (byId.has(id)) updated += 1; else added += 1
    byId.set(id, next)
  })
  const entries = Array.from(byId.values()).sort(compareEntries)
  return { entries, added, updated }
}

/** Retire des entrées par id. Renvoie `{ entries, removed }`. */
export function removeEntries(existing, ids) {
  const kill = new Set(asArray(ids).map((x) => String(x).replace(/^\/+/, '').trim()))
  const before = asArray(existing)
  const entries = before.filter((e) => { const id = idOf(e); return id === null || kill.has(id) === false })
  return { entries, removed: before.length - entries.length }
}

/** L'aperçu du texte produit, rempli avec les défauts : ce que l'utilisateur verra. */
export function previewOf(entry, message) {
  const values = {}
  visibleFields(entry, values).forEach((f) => { if (f.default !== undefined) values[f.key] = f.default })
  const ok = validate(entry, values).ok
  return { ok, text: render(entry.template, values, { message: message === undefined ? '' : message }) }
}

// ── La route ────────────────────────────────────────────────────────────────
const MAX_ENTRIES = 500

/**
 * Applique un corps de POST au magasin. Contrat accepté :
 *   - une entrée seule (objet avec `id`/`slug`/`name`)        → upsert
 *   - un tableau d'entrées                                    → upsert multiple
 *   - `{ entry: {...} }` ou `{ entries: [...] }`              → upsert
 *   - `{ delete: "id" | ["id", ...] }` / `{ remove: ... }`    → suppression
 *   - `{ replace: [...] }`                                    → remplacement complet
 * Renvoie `{ ok, entries, added, updated, removed, error? }` sans jamais lever.
 */
export function applyMutation(store, body) {
  try {
    const b = isI18n(body) ? body : {}
    const list = asArray(store)

    if (b.replace !== undefined) {
      const next = asArray(b.replace).map((e) => canonicalize(e)).filter((e) => idOf(e) !== null)
      if (next.length > MAX_ENTRIES) return { ok: false, error: 'trop d entrées', entries: list }
      // Fusion sur une base vide : deux entrées de même id dans le lot ne
      // produisent qu'une ligne, exactement comme un upsert.
      const dedup = mergeEntries([], next).entries
      return { ok: true, entries: dedup, added: dedup.length, updated: 0, removed: list.length }
    }

    const del = b.delete !== undefined ? b.delete : b.remove
    if (del !== undefined) {
      const out = removeEntries(list, del)
      return { ok: true, entries: out.entries, added: 0, updated: 0, removed: out.removed }
    }

    const incoming = Array.isArray(body)
      ? body
      : (b.entry !== undefined ? b.entry : (b.entries !== undefined ? b.entries : (idOf(b) !== null ? b : [])))
    const raws = asArray(incoming)
    if (raws.length === 0) return { ok: false, error: 'aucune entree fournie', entries: list }

    const canon = []
    for (const raw of raws) {
      const entry = canonicalize(raw)
      if (idOf(entry) === null) return { ok: false, error: 'id manquant', entries: list }
      canon.push(entry)
    }
    const out = mergeEntries(list, canon)
    if (out.entries.length > MAX_ENTRIES) return { ok: false, error: 'trop d entrées', entries: list }
    return { ok: true, entries: out.entries, added: out.added, updated: out.updated, removed: 0 }
  } catch (e) {
    return { ok: false, error: e && e.message ? String(e.message) : 'mutation impossible' }
  }
}

const mountWebRoutes = (ctx, webServerSvc) => {
  // Le registre « exact » du serveur web est indexé par CHEMIN, pas par
  // (chemin, méthode) : « Duplicate paths throw » (dsh-host-webserver/lib/index.js,
  // table `exact`). Enregistrer un GET *et* un POST sur `/kybernos/slash/entries`
  // fait donc lever le second — et la route survivante répond 405 à l'autre
  // méthode. C'est pourquoi le chemin « entries » n'a qu'UN enregistrement, qui
  // dispatche lui-même sur `req.method`.
  const ROUTE = (path, label, fn) => ctx.effect(() => webServerSvc.register({ kind: 'exact', path, handler: async (req, res) => {
    try { await fn(req, res) } catch (e) { sendJson(res, 500, { ok: false, error: 'requete impossible' }) }
  } }), label)

  const GET = (path, label, fn) => ROUTE(path, label, async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET attendu' })
    sendJson(res, 200, await fn(req))
  })

  ROUTE('/kybernos/slash/entries', 'kybernos-slash: entrees (lire et ecrire)', async (req, res) => {
    if (req.method === 'GET') {
      const p = storePath()
      // m10 : la lecture ne portait pas de `total` alors que POST et /status
      // l'exposent — un client qui pagine devait compter lui-meme. Meme forme que
      // /status pour que les deux routes se lisent pareil.
      const entries = readStore(p).sort(compareEntries)
      return sendJson(res, 200, {
        ok: true, version: MODEL_VERSION, path: p,
        total: entries.length,
        slash: entries.filter((e) => (e.kind === 'action' ? 'action' : 'slash') === 'slash').length,
        action: entries.filter((e) => e.kind === 'action').length,
        entries: entries,
      })
    }
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'GET ou POST attendu' })
    // Gardes dans cet ordre : méthode d'abord, origine ensuite. Aucune requête
    // POST ne touche au disque avant les deux.
    if (sameOrigin(req) === false) return sendJson(res, 403, { ok: false, error: 'origine refusee' })
    let body = null
    try { body = await readJsonBody(req) } catch (e) { return sendJson(res, 400, { ok: false, error: 'corps JSON invalide' }) }
    const p = storePath()
    const before = readStore(p)
    const out = applyMutation(before, body)
    // Un refus de validation sort en 400 : un appelant qui ne lit que le code de
    // statut ne doit jamais prendre une entree refusee pour un ecrit reussi.
    if (out.ok === false) return sendJson(res, 400, { ok: false, error: out.error, path: p, total: before.length })
    writeStore(out.entries, p)
    // On relit ce qu'on vient d'écrire : la route ne dit jamais « écrit » sur un
    // fichier qu'elle n'a pas vérifié (même exigence que le skill).
    const after = readStore(p)
    return sendJson(res, 200, { ok: true, path: p, total: after.length, added: out.added, updated: out.updated, removed: out.removed, entries: after })
  })

  GET('/kybernos/slash/status', 'kybernos-slash: etat du magasin', async () => {
    const p = storePath()
    let exists = false
    let bytes = 0
    let mtime = null
    try { const st = statSync(p); exists = st.isFile(); bytes = st.size; mtime = st.mtime.toISOString() } catch (e) { exists = false }
    const entries = readStore(p)
    return {
      ok: true, version: MODEL_VERSION, path: p, exists, bytes, mtime,
      total: entries.length,
      slash: entries.filter((e) => (e.kind === 'action' ? 'action' : 'slash') === 'slash').length,
      action: entries.filter((e) => e.kind === 'action').length,
    }
  })

  // Le texte d'un message reçu : une action dont le gabarit contient
  // `{message}` en a besoin, et la barre d'actions ne connaît que son
  // identifiant. Même voie que la synthèse vocale (sessionPersistence).
  GET('/kybernos/slash/message', 'kybernos-slash: texte d un message', async (req) => {
    const sessionId = queryParam(req, 'sessionId')
    const messageId = queryParam(req, 'messageId')
    if (sessionId === null || messageId === null) return { ok: false, error: 'sessionId et messageId requis' }
    return messageText(ctx, sessionId, messageId)
  })

  console.log('[kybernos-slash] routes /kybernos/slash/* enregistrees (entries GET+POST sur un seul chemin, status, message) — magasin ' + storePath())
}

/**
 * Retrouve le texte d'un message à partir de son identifiant, en relisant le
 * fil de la session. C'est la seule voie pour un gabarit qui contient
 * `{message}` : la barre d'actions ne reçoit que `sessionId` + `messageId`.
 * Ne lève jamais ; rend `{ok:false}` si le texte n'est pas trouvé.
 * @param ctx - contexte cordis (pour `sessionPersistence`).
 * @param sessionId - session visée.
 * @param messageId - identifiant du message visé.
 * @returns {Promise<{ok:true,text:string}|{ok:false,error:string}>} texte du message.
 */
export async function messageText(ctx, sessionId, messageId) {
  const persistence = (ctx !== null && ctx !== undefined && typeof ctx.get === 'function') ? ctx.get('sessionPersistence') : null
  if (persistence === null || persistence === undefined || typeof persistence.open !== 'function') {
    return { ok: false, error: 'sessionPersistence indisponible' }
  }
  let events = []
  try {
    const handle = await persistence.open(sessionId, 'read')
    try {
      const read = await handle.read()
      events = (read !== null && read !== undefined && Array.isArray(read.events) === true) ? read.events : []
    } finally {
      try { if (handle !== null && handle !== undefined && typeof handle.close === 'function') await handle.close() } catch (e) { /* déjà fermé */ }
    }
  } catch (e) {
    return { ok: false, error: 'fil illisible' }
  }
  for (const ev of events) {
    if (ev === null || ev === undefined || typeof ev !== 'object') continue
    if (ev.type !== 'assistant/message') continue
    const data = ev.data
    const message = (data !== null && data !== undefined && typeof data === 'object') ? data.message : null
    if (message === null || message === undefined) continue
    if (String(message.id) !== String(messageId)) continue
    const parts = []
    if (Array.isArray(message.content) === true) {
      for (const block of message.content) {
        if (block !== null && block !== undefined && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
      }
    }
    return { ok: true, text: parts.join('\n') }
  }
  return { ok: false, error: 'message introuvable' }
}

export function apply(ctx) {
  // Filet miroir de kybernos-plugin/index.js : une erreur de montage ne doit pas
  // couper la GUI — les routes tombent seules, l'erreur est tracée.
  try {
    ctx.inject(['webServer'], (hostCtx) => {
      try {
        mountWebRoutes(hostCtx, hostCtx.get('webServer'))
      } catch (e) {
        try { console.error('[kybernos-slash] montage des routes impossible', e) } catch (e2) { /* console indisponible */ }
      }
    })
  } catch (ksBootError) {
    try {
      console.error('[kybernos-slash] demarrage impossible — routes /kybernos/slash/* non montees', ksBootError)
    } catch (e2) { /* console indisponible */ }
  }
}

export { MODEL_VERSION, normalize, runOf, hasForm, visibleFields, validate, render, pluginDir }
