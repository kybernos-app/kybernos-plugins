// ═══════════════════════════════════════════════════════════════════════════
// kybernos-bricks — moitié HÔTE.
//
// LE POC : depuis le chat DSH, on demande une maquette en briques ; le rendu
// s'anime dans la barre latérale DROITE, brique par brique, puis se relit.
//
// Ce fichier ne dessine rien : il tient le CONTRAT entre les deux moitiés.
//   1. un OUTIL (`animer_briques`) que l'agent appelle depuis le chat ;
//   2. deux ROUTES que le panneau client interroge :
//        POST /kybernos-bricks/push   → dépose une commande de construction
//        GET  /kybernos-bricks/state  → lit l'état courant (version, t0, ops)
//
// POURQUOI UN OUTIL ET PAS UNE ROUTE APPELÉE À LA MAIN : l'agent n'a pas de
// fetch ; un outil est le seul chemin par lequel le chat peut déclencher le
// panneau. La route existe pour la moitié CLIENT, pas pour l'agent.
//
// POURQUOI LE DÉLAI VIENT D'ICI : `t0` est posé au moment du push, et le client
// pose `total × (now − t0) / durée` briques. Le rythme est donc celui de
// l'hôte — un onglet qui arrive en retard rattrape son retard au lieu de
// rejouer depuis zéro.
//
// Aucun import statique de `@deepseek-ai/*` : un plugin lié en `@local/…` n'a
// pas ces paquets dans sa portée. `defineTool` est résolu paresseusement, avec
// un repli littéral (même schéma que kybernos-relance).
// ═══════════════════════════════════════════════════════════════════════════

import { existsSync } from 'node:fs'
import { writeGuard } from './session-guard.mjs'
import { homedir } from 'node:os'
import { join } from 'node:path'
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

export const name = 'kybernos-bricks'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const OUTIL = 'animer_briques'
const ROUTE_PUSH = '/kybernos-bricks/push'
const ROUTE_STATE = '/kybernos-bricks/state'
const DUREE_DEFAUT_MS = 12_000
const DUREE_MIN_MS = 1_500
const DUREE_MAX_MS = 120_000

const dire = (msg) => console.log(`[kybernos-bricks] ${msg}`)

// ── résolution paresseuse de `defineTool` ───────────────────────────────────
const CANDIDATS_DSH_TOOLS = [
  join(DSH_HOME, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
  '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
]

async function chargerDefineTool () {
  for (const chemin of CANDIDATS_DSH_TOOLS) {
    if (!existsSync(chemin)) continue
    try {
      const module = await import(chemin)
      if (typeof module?.defineTool === 'function') return { defineTool: module.defineTool, chemin }
    } catch (e) { dire(`defineTool unreadable from ${chemin}: ${e?.message ?? e}`) }
  }
  return undefined
}

/** Repli : la forme EXACTE que `defineTool` produit (vérifiée sur dsh-tools 0.1.7). */
export function definitionLiteral (options) {
  return {
    name: options.name,
    description: options.description,
    parameters: { type: 'object', properties: options.parameters },
    output: { schema: {}, render: (args, value) => options.render(args, value) },
    execute: options.execute,
  }
}

/** Traduit la forme « spec » en définition attendue par `defineTool`. */
export function specDefineTool (options) {
  return {
    name: options.name,
    description: options.description,
    parameters: options.parameters,
    output: { schema: { type: 'json' }, render: (args, value) => options.render(args, value) },
    execute: options.execute,
  }
}

// ── le magasin : une commande de construction par session ───────────────────
/**
 * Le magasin est un simple Map en mémoire, sans persistance : une maquette est
 * un spectacle, pas un document. `version` s'incrémente à chaque push — c'est
 * ce que le client compare pour savoir qu'il y a du neuf à poser.
 */
export function creerMagasin () {
  const parSession = new Map()
  let compteur = 0
  return {
    /** Dépose une commande ; rend l'enregistrement complet. */
    pousser (entree) {
      const sessionId = typeof entree?.sessionId === 'string' && entree.sessionId.length > 0
        ? entree.sessionId
        : 'sans-session'
      const precedente = parSession.get(sessionId)
      const maintenant = Date.now()
      // A call with nothing to build (no ops, no prompt, no archetype key) only asks for the panel to open. It must
      // not replace the model by an empty one: the client keeps showing what it has, and the host used to forget it.
      // The request is carried by a counter the client watches; the model itself is left as it was.
      const aDuContenu = Array.isArray(entree?.ops) || texte(entree?.prompt, 2000) !== '' || texte(entree?.cle, 60) !== ''
      if (!aDuContenu && precedente !== undefined) {
        precedente.ouverture = (precedente.ouverture ?? 0) + 1
        precedente.global = ++compteur
        return { ...precedente, rouvert: true }
      }
      const enregistrement = {
        version: (precedente?.version ?? 0) + 1,
        global: ++compteur,
        sessionId,
        t0: maintenant,
        // L1-07: the preview chips of the panel post `duree_ms` (the name of the tool's parameter), the host's own record says `dureeMs`:
        // both are read, or the 9 s a chip asks for fell back to the 12 s default.
        dureeMs: bornement(entree?.dureeMs ?? entree?.duree_ms),
        titre: texte(entree?.titre, 120) || 'Bricks',
        prompt: texte(entree?.prompt, 2000),
        mode: entree?.mode === 'modifier' ? 'modifier' : 'nouveau',
        ops: Array.isArray(entree?.ops) ? entree.ops.slice(0, 4000) : null,
        cle: texte(entree?.cle, 60) || null,
        ouverture: 0,
        pose: maintenant,
      }
      parSession.set(sessionId, enregistrement)
      return enregistrement
    },
    /** L'état d'une session ; à défaut, la dernière commande déposée. */
    lire (sessionId) {
      if (typeof sessionId === 'string' && sessionId.length > 0 && parSession.has(sessionId)) {
        return parSession.get(sessionId)
      }
      return derniere(parSession)
    },
    sessions () { return [...parSession.keys()] },
  }
}

function derniere (map) {
  let meilleur = null
  for (const valeur of map.values()) if (meilleur === null || valeur.global > meilleur.global) meilleur = valeur
  return meilleur
}

function bornement (valeur) {
  const n = Number(valeur)
  if (!Number.isFinite(n) || n <= 0) return DUREE_DEFAUT_MS
  return Math.min(DUREE_MAX_MS, Math.max(DUREE_MIN_MS, Math.round(n)))
}

function texte (valeur, max) {
  if (typeof valeur !== 'string') return ''
  const propre = valeur.replace(/\s+/g, ' ').trim()
  return propre.length > max ? propre.slice(0, max) : propre
}

// ── l'outil ─────────────────────────────────────────────────────────────────

export function optionsOutil (magasin) {
  return {
    name: OUTIL,
    description:
      'Builds a brick model and animates it in the right sidebar of the chat (the “Bricks” panel), '
      + 'brick by brick, then leaves it replayable. '
      + 'Two ways to use it: either `prompt` describes the model (in English or French) and the panel picks an archetype '
      + '(castle, chalet, lighthouse, rocket, robot, clock square, mosaic, van, hummingbird), '
      + 'or `ops` describes the geometry explicitly — the path where YOU do the drawing. '
      + "Each op is a batch: {op:'rect',x,y,z,w,d,h,color,group} | {op:'disc',cx,cy,r,z,h,color} | "
      + "{op:'ring',cx,cy,r,t,z,h,color} | {op:'cone',cx,cy,z,r,niveaux,color} | {op:'tree',x,y,z,h} | "
      + "{op:'archetype',cle:'castle'}. The ops are laid in the order of the array. "
      + 'A call with neither `ops` nor `prompt` only opens the panel on the last model.',
    parameters: {
      prompt: { type: 'string', description: 'What the user wants to build. Used to pick the archetype and the title. With mode “modifier” a prompt alone changes nothing: send `ops`.' },
      ops: {
        type: 'array',
        description: 'Explicit geometry, laid in order. Each element is a batch (see the description of the tool). Takes precedence over `prompt`.',
        items: { type: 'object', additionalProperties: true },
      },
      mode: { type: 'string', description: '“nouveau” (replaces the model) or “modifier” (adds the `ops` to the current model; it needs `ops`). Default: nouveau.' },
      titre: { type: 'string', description: 'Title shown in the panel. Default: taken from the prompt, or “Bricks”.' },
      duree_ms: { type: 'number', description: `Duration of the laying, in milliseconds (default ${DUREE_DEFAUT_MS}, between ${DUREE_MIN_MS} and ${DUREE_MAX_MS}).` },
    },
    render: (_args, valeur) => [{ type: 'text', text: typeof valeur === 'string' ? valeur : JSON.stringify(valeur, null, 2) }],
    execute: async (brut, exec) => {
      const options = brut && typeof brut === 'object' ? brut : {}
      const sessionId = exec?.agent?.id
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        return { ok: false, raison: 'agent_inconnu', message: 'cannot identify the current session (called outside a turn?)' }
      }
      const enregistrement = magasin.pousser({
        sessionId,
        prompt: options.prompt,
        ops: options.ops,
        mode: options.mode,
        titre: options.titre,
        dureeMs: options.duree_ms,
      })
      return {
        ok: true,
        version: enregistrement.version,
        sessionId,
        titre: enregistrement.titre,
        mode: enregistrement.mode,
        lots: Array.isArray(enregistrement.ops) ? enregistrement.ops.length : 0,
        duree_ms: enregistrement.dureeMs,
        message: enregistrement.rouvert === true
          ? 'Panel reopened on the last model: nothing was rebuilt or erased (give `prompt` or `ops` to build).'
          : enregistrement.mode === 'modifier' && !Array.isArray(enregistrement.ops)
          ? 'Nothing was added: mode “modifier” takes `ops`, and a prompt alone does not change the current model (it only builds when the panel has no model yet). Give `ops`, or use mode “nouveau” to rebuild from the prompt.'
          : Array.isArray(enregistrement.ops)
          ? `${enregistrement.ops.length} ${enregistrement.ops.length === 1 ? 'batch' : 'batches'} of bricks handed over: the “Bricks” panel (right sidebar) lays them in ${(enregistrement.dureeMs / 1000).toFixed(1)} s.`
          : 'Model handed over: the “Bricks” panel (right sidebar) is building it now.',
      }
    },
  }
}

/** Enregistre l'outil sur un service `tools` déjà résolu. */
export async function enregistrer (tools, magasin) {
  const definition = optionsOutil(magasin)
  const chargement = await chargerDefineTool()
  const outil = chargement !== undefined ? chargement.defineTool(specDefineTool(definition)) : definitionLiteral(definition)
  tools.register(outil)
  dire(`tool “${OUTIL}” registered`)
}

// ── les routes (pour la moitié client) ──────────────────────────────────────

const envoyer = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

const origineOK = (req) => {
  // Recette 2026-10 (M-02/S-03) : l'ancien test par préfixe laissait passer
  // « http://localhost.evil.example » et « http://127.0.0.1.nip.io ». On
  // exige maintenant l'hôte EXACT de l'adresse réelle d'écoute du socket ;
  // l'absence d'Origin reste tolérée pour les appels locaux de confiance
  // (outils serveur, GET same-origin où le navigateur n'envoie pas Origin).
  const o = String(req.headers.origin || '')
  if (o === '') return true
  try {
    const u = new URL(o)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const port = (req.socket && typeof req.socket.localPort === 'number') ? ':' + req.socket.localPort : ''
    return (['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host))
  } catch { return false }
}

// The body of a POST, counted as it arrives: the rule of `readBody(req, cap)` in kybernos-search/guard.mjs (bundles read on their own, so the small
// function is copied, not imported), over events because the tests of this bundle drive the routes with a request stand-in that has `on()` only.
// Past `cap` bytes nothing more is kept, the caller gets 413 with `Connection: close` and the request is destroyed once the answer is out; the
// promise then resolves `null` and the route stops (the answer is already sent). Before, the body was added to a string without any limit: past
// 512 MB that throws `RangeError: Invalid string length` inside the 'data' listener, where nobody catches it, and DSH ends with all its sessions
// (recette L3-43). A request that ends badly (aborted, reset) resolves `null` too: nobody is left to answer.
// 2 MiB: the only POST is the push of a model, `ops` is cut to 4000 batches by the store and a batch is about 110 bytes ({op:'rect',x,y,z,w,d,h,color,group}),
// so the largest honest body is about 0.5 MiB.
const CORPS_MAX = 2 * 1024 * 1024
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
      try { res.setHeader?.('Connection', 'close') } catch { /* a stand-in */ }
      try { res.once?.('finish', () => req.destroy?.()) } catch { /* a stand-in */ }
      envoyer(res, 413, { ok: false, raison: 'corps_trop_gros', message: 'The body is too large (' + Math.round(cap / (1024 * 1024)) + ' MiB at most).' })
      finir(null)
      return
    }
    morceaux.push(octets)
  })
  req.on('end', () => {
    if (fini) return
    const brut = morceaux.length === 0 ? '' : Buffer.concat(morceaux).toString('utf8')
    // `null` is the "already answered" signal of this function, so a body that is the JSON text `null` reads as an empty one.
    try { finir(JSON.parse(brut || '{}') ?? {}) } catch { finir({}) }
  })
  req.on('error', () => finir(null))
  req.on('close', () => finir(null))
})

export function monterRoutes (webServerSvc, magasin) {
  webServerSvc = kbFenced(webServerSvc)
  webServerSvc.register({ kind: 'exact', path: ROUTE_STATE, handler: async (req, res) => {
    if (req.method !== 'GET') { res.writeHead(405); res.end('GET only'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    const u = new URL(req.url, 'http://127.0.0.1')
    const etat = magasin.lire(u.searchParams.get('session'))
    if (etat === null) { envoyer(res, 200, { vide: true }); return }
    envoyer(res, 200, {
      vide: false,
      version: etat.version,
      global: etat.global,
      sessionId: etat.sessionId,
      t0: etat.t0,
      dureeMs: etat.dureeMs,
      titre: etat.titre,
      prompt: etat.prompt,
      mode: etat.mode,
      cle: etat.cle,
      ops: etat.ops,
      ouverture: etat.ouverture ?? 0,
      serveur: Date.now(),
    })
  } })

  webServerSvc.register({ kind: 'exact', path: ROUTE_PUSH, handler: async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST only'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    // A-16: a push WRITES the model a panel replays. Its caller is the panel in the person's page (same-origin fetch, so the browser
    // sends its cookie); the agent's `animer_briques` tool writes the store in-process and never goes through this route.
    const refus = writeGuard(req)
    if (refus !== null) { envoyer(res, refus.status, { ok: false, error: refus.error }); return }
    // Recette 2026-10 (M-02) : un POST qui écrit l'état exige du JSON —
    // text/plain multipart etc. sont refusés.
    const ct = String(req.headers['content-type'] || '')
    if (ct !== '' && /^application\/json/i.test(ct) === false) { res.writeHead(415); res.end('JSON content-type expected'); return }
    const corps = await lireCorps(req, res)
    if (corps === null) return
    // An unreadable body must not leave an empty model behind: it would become "the last model" for a panel that
    // does not name its session.
    if (!corps || typeof corps !== 'object' || (!Array.isArray(corps.ops) && texte(corps.prompt, 2000) === '' && texte(corps.cle, 60) === '')) {
      envoyer(res, 400, { ok: false, raison: 'corps_illisible', message: 'POST /push expects `ops` (an array), `prompt` or `cle`.' })
      return
    }
    const etat = magasin.pousser(corps)
    envoyer(res, 200, { ok: true, version: etat.version, titre: etat.titre, dureeMs: etat.dureeMs })
  } })

  dire(`routes ${ROUTE_STATE} and ${ROUTE_PUSH} registered`)
}

// ── le plugin hôte ──────────────────────────────────────────────────────────

export function apply (ctx) {
  if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') ctx.effect(() => kbRetirerRoutes, 'kybernos-bricks: routes')
  const magasin = creerMagasin()
  // Les services sont lus par `ctx.get` (jamais `ctx.<nom>` avant que l'inject
  // n'ait résolu) : c'est la forme qui marche aussi bien dans cordis que dans
  // un contexte de test qui ne porte que `get`.
  const demarrer = (c) => {
    const tools = c.get('tools')
    const webServer = c.get('webServer')
    if (tools !== undefined) enregistrer(tools, magasin).catch((e) => dire(`tool not registered: ${e?.message ?? e}`))
    if (webServer !== undefined) {
      try { monterRoutes(webServer, magasin) } catch (e) { dire(`routes not mounted: ${e?.message ?? e}`) }
    }
  }
  if (ctx.get('tools') !== undefined && ctx.get('webServer') !== undefined) demarrer(ctx)
  else ctx.inject(['tools', 'webServer'], demarrer)
}