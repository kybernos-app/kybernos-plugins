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
import { homedir } from 'node:os'
import { join } from 'node:path'
// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle publishes the predicate
// (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers false and the guard stays loopback-only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }

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
    } catch (e) { dire(`defineTool illisible depuis ${chemin} : ${e?.message ?? e}`) }
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
        dureeMs: bornement(entree?.dureeMs),
        titre: texte(entree?.titre, 120) || 'Briques',
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
      "Construit une maquette en briques et l'anime dans la barre latérale droite du chat (panneau « Briques »), "
      + 'brique par brique, puis la laisse rejouable. '
      + "Deux façons de s'en servir : soit `prompt` décrit la maquette en français et le panneau choisit un archétype "
      + '(château, chalet, phare, fusée, robot, place à horloge, mosaïque, van, colibri), '
      + "soit `ops` décrit explicitement la géométrie — c'est le chemin où c'est TOI qui dessines. "
      + "Chaque op est un lot : {op:'rect',x,y,z,w,d,h,color,group} | {op:'disc',cx,cy,r,z,h,color} | "
      + "{op:'ring',cx,cy,r,t,z,h,color} | {op:'cone',cx,cy,z,r,niveaux,color} | {op:'tree',x,y,z,h} | "
      + "{op:'archetype',cle:'chateau'}. Les opés sont posées dans l'ordre du tableau. "
      + 'Un appel sans `ops` ni `prompt` se contente d\'ouvrir le panneau sur la dernière maquette.',
    parameters: {
      prompt: { type: 'string', description: "Ce que l'utilisateur veut construire, ou la modification demandée. Sert à choisir l'archétype et le titre." },
      ops: {
        type: 'array',
        description: 'Géométrie explicite, posée dans l\'ordre. Chaque élément est un lot (voir la description de l\'outil). Prioritaire sur `prompt`.',
        items: { type: 'object', additionalProperties: true },
      },
      mode: { type: 'string', description: "« nouveau » (remplace la maquette) ou « modifier » (ajoute à la maquette courante). Défaut : nouveau." },
      titre: { type: 'string', description: 'Titre affiché dans le panneau. Défaut : déduit du prompt, ou « Briques ».' },
      duree_ms: { type: 'number', description: `Durée de la pose, en millisecondes (défaut ${DUREE_DEFAUT_MS}, borné ${DUREE_MIN_MS}–${DUREE_MAX_MS}).` },
    },
    render: (_args, valeur) => [{ type: 'text', text: typeof valeur === 'string' ? valeur : JSON.stringify(valeur, null, 2) }],
    execute: async (brut, exec) => {
      const options = brut && typeof brut === 'object' ? brut : {}
      const sessionId = exec?.agent?.id
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        return { ok: false, raison: 'agent_inconnu', message: "impossible d'identifier la session courante (appel hors tour ?)" }
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
          ? 'Panneau rouvert sur la dernière maquette : rien n\'a été reconstruit ni effacé (donne `prompt` ou `ops` pour construire).'
          : Array.isArray(enregistrement.ops)
          ? `${enregistrement.ops.length} lot(s) de briques déposés : le panneau « Briques » (barre latérale droite) va les poser en ${(enregistrement.dureeMs / 1000).toFixed(1)} s.`
          : 'Maquette déposée : le panneau « Briques » (barre latérale droite) la construit maintenant.',
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
  dire(`outil « ${OUTIL} » enregistré`)
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

const lireCorps = (req) => new Promise((res) => {
  let corps = ''
  req.on('data', (d) => { corps += d })
  req.on('end', () => { try { res(JSON.parse(corps || '{}')) } catch { res({}) } })
})

export function monterRoutes (webServerSvc, magasin) {
  webServerSvc.register({ kind: 'exact', path: ROUTE_STATE, handler: async (req, res) => {
    if (req.method !== 'GET') { res.writeHead(405); res.end('GET uniquement'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
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
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST uniquement'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    // Recette 2026-10 (M-02) : un POST qui écrit l'état exige du JSON —
    // text/plain multipart etc. sont refusés.
    const ct = String(req.headers['content-type'] || '')
    if (ct !== '' && /^application\/json/i.test(ct) === false) { res.writeHead(415); res.end('content-type json attendu'); return }
    const corps = await lireCorps(req)
    // An unreadable body must not leave an empty model behind: it would become "the last model" for a panel that
    // does not name its session.
    if (!corps || typeof corps !== 'object' || (!Array.isArray(corps.ops) && texte(corps.prompt, 2000) === '' && texte(corps.cle, 60) === '')) {
      envoyer(res, 400, { ok: false, raison: 'corps_illisible', message: 'POST /push attend `ops` (tableau), `prompt` ou `cle`.' })
      return
    }
    const etat = magasin.pousser(corps)
    envoyer(res, 200, { ok: true, version: etat.version, titre: etat.titre, dureeMs: etat.dureeMs })
  } })

  dire(`routes ${ROUTE_STATE} et ${ROUTE_PUSH} enregistrées`)
}

// ── le plugin hôte ──────────────────────────────────────────────────────────

export function apply (ctx) {
  const magasin = creerMagasin()
  // Les services sont lus par `ctx.get` (jamais `ctx.<nom>` avant que l'inject
  // n'ait résolu) : c'est la forme qui marche aussi bien dans cordis que dans
  // un contexte de test qui ne porte que `get`.
  const demarrer = (c) => {
    const tools = c.get('tools')
    const webServer = c.get('webServer')
    if (tools !== undefined) enregistrer(tools, magasin).catch((e) => dire(`outil non enregistré : ${e?.message ?? e}`))
    if (webServer !== undefined) {
      try { monterRoutes(webServer, magasin) } catch (e) { dire(`routes non montées : ${e?.message ?? e}`) }
    }
  }
  if (ctx.get('tools') !== undefined && ctx.get('webServer') !== undefined) demarrer(ctx)
  else ctx.inject(['tools', 'webServer'], demarrer)
}