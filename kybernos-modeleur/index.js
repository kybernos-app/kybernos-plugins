// ═══════════════════════════════════════════════════════════════════════════
// kybernos-modeleur — moitié HÔTE.
//
// Depuis le chat DSH, l'agent dessine un modèle 2D (schéma, plan) ou 3D
// (solides) ; le rendu s'anime dans la barre latérale DROITE, trait par
// objet, puis se relit. Le contrat est celui du POC vérifié
// `kybernos-bricks`, généralisé aux deux espaces :
//   1. un OUTIL (`modeliser`) que l'agent appelle depuis le chat ;
//   2. deux ROUTES que le panneau client interroge :
//        POST /kybernos-modeleur/push   → dépose une commande de dessin
//        GET  /kybernos-modeleur/state  → lit l'état courant (version, t0, ops)
//
// POURQUOI UN OUTIL ET PAS UNE ROUTE APPELÉE À LA MAIN : l'agent n'a pas de
// fetch ; un outil est le seul chemin par lequel le chat peut déclencher le
// panneau. La route existe pour la moitié CLIENT, pas pour l'agent.
//
// POURQUOI LE DÉLAI VIENT D'ICI : `t0` est posé au moment du push, et le
// client pose `total × (now − t0) / durée` objets. Le rythme est donc celui de
// l'hôte — un onglet qui arrive en retard rattrape son retard au lieu de
// rejouer depuis zéro.
//
// Aucun import statique de `@deepseek-ai/*` : un plugin lié en `@local/…` n'a
// pas ces paquets dans sa portée. `defineTool` est résolu paresseusement, avec
// un repli littéral (même schéma que kybernos-bricks et kybernos-relance).
// ═══════════════════════════════════════════════════════════════════════════

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'kybernos-modeleur'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const OUTIL = 'modeliser'
const ROUTE_PUSH = '/kybernos-modeleur/push'
const ROUTE_STATE = '/kybernos-modeleur/state'
const ROUTE_ANNOTE = '/kybernos-modeleur/annote'
const DUREE_DEFAUT_MS = 8_000
const DUREE_MIN_MS = 1_500
const DUREE_MAX_MS = 120_000

const dire = (msg) => console.log(`[kybernos-modeleur] ${msg}`)

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

const ESPACES = new Set(['2d', '3d'])
const espaceDe = (v) => (ESPACES.has(v) ? v : '3d')

// ── le magasin : une commande de dessin par session ─────────────────────────
/**
 * Le magasin est un simple Map en mémoire, sans persistance : un modèle est
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
      // `modifier` garde l'espace courant : dessiner en 2D sur une scène 3D
      // remplacerait un modèle par un autre sans prévenir l'œil.
      const espace = espaceDe(entree?.espace ?? (entree?.mode === 'modifier' ? precedente?.espace : undefined))
      const enregistrement = {
        version: (precedente?.version ?? 0) + 1,
        global: ++compteur,
        sessionId,
        espace,
        t0: maintenant,
        dureeMs: bornement(entree?.dureeMs),
        titre: texte(entree?.titre, 120) || 'Modeleur',
        prompt: texte(entree?.prompt, 2000),
        mode: entree?.mode === 'modifier' && precedente?.espace === espace ? 'modifier' : 'nouveau',
        ops: Array.isArray(entree?.ops) ? entree.ops.slice(0, 4000) : null,
        ann: { version: 0, strokes: [] },
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
    /** Dépose (ou remplace) les traits dessinés par-dessus le modèle courant. */
    annoter (sessionId, strokes) {
      const enregistrement = this.lire(sessionId)
      if (enregistrement === null) return null
      enregistrement.ann = { version: (enregistrement.ann?.version ?? 0) + 1, strokes }
      return enregistrement
    },
    sessions () { return [...parSession.keys()] },
  }
}

/** Normalise les annotations reçues du panneau : type connu, coul hex,
 * pts [[x,y]…] en 0..1, texte court — borné à 60 annotations de 800 points.
 * Types : trait (≥2 pts), rect|ellipse|fleche (2 pts), texte (1 pt + text). */
const TYPES_ANN = new Set(['trait', 'rect', 'ellipse', 'fleche', 'texte'])
function traitsPropres (brut) {
  if (!Array.isArray(brut)) return []
  const sorties = []
  for (const t of brut.slice(0, 60)) {
    const type = typeof t?.type === 'string' && TYPES_ANN.has(t.type) ? t.type : 'trait'
    const coul = typeof t?.coul === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.coul) ? t.coul : '#E1502A'
    const maxPts = type === 'trait' ? 800 : 2
    const pts = Array.isArray(t?.pts)
      ? t.pts.slice(0, maxPts).map((p) => [
          Math.max(0, Math.min(1, Number(p?.[0]) || 0)),
          Math.max(0, Math.min(1, Number(p?.[1]) || 0)),
        ])
      : []
    const minPts = type === 'texte' ? 1 : 2
    if (pts.length < minPts) continue
    const annotation = { type, coul, pts }
    if (type === 'texte') {
      const contenu = typeof t?.text === 'string' ? t.text.trim().slice(0, 240) : ''
      if (contenu.length === 0) continue
      annotation.text = contenu
    }
    sorties.push(annotation)
  }
  return sorties
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
      "Dessine un modèle 2D ou 3D dans la barre latérale droite du chat (panneau « Modeleur »), "
      + 'objet par objet, puis le laisse rejouable. `espace` choisit le moteur : '
      + "« 3d » (défaut) rend des solides en perspective orbitable — ops : {op:'box',x,y,z,w,d,h,color} | "
      + "{op:'cyl',cx,cy,z,r,h,color} | {op:'cone',cx,cy,z,r,h,color} | {op:'sphere',cx,cy,cz,r,color} | "
      + "{op:'tube',cx,cy,z,r,t,h,color} | {op:'extrude',points:[[x,y]…],z,h,color} ; "
      + "« 2d » rend un dessin à l'échelle — ops : {op:'line',x1,y1,x2,y2} | {op:'rect',x,y,w,h} | "
      + "{op:'circle',cx,cy,r} | {op:'ellipse',cx,cy,rx,ry} | {op:'arc',cx,cy,r,a0,a1} | "
      + "{op:'poly',points:[[x,y]…],closed} | {op:'path',d} | {op:'text',x,y,text} | {op:'arrow',x1,y1,x2,y2}. "
      + "Chaque op accepte `stroke`, `fill`, `width`, `group`. Les opés sont posées dans l'ordre du tableau. "
      + "L'utilisateur peut dessiner des traits PAR-DESSUS le modèle (pinceau du panneau) pour montrer ce qu'il "
      + 'veut changer : `relire: true` renvoie ces traits en coordonnées normalisées 0..1 (origine coin haut-gauche) '
      + "+ la caméra 3D du moment — sert-t'en pour réajuster avec `mode: 'modifier'`. Sans `ops`, l'appel ouvre le panneau sur le dernier modèle.",
    parameters: {
      espace: { type: 'string', description: "« 3d » (défaut, solides orbitables) ou « 2d » (dessin à l'échelle)." },
      prompt: { type: 'string', description: "Ce que le modèle représente, en une phrase — affiché sous le dessin." },
      ops: {
        type: 'array',
        description: "Géométrie explicite, posée dans l'ordre. Chaque élément est un lot (voir la description de l'outil).",
        items: { type: 'object', additionalProperties: true },
      },
      mode: { type: 'string', description: "« nouveau » (remplace le modèle) ou « modifier » (ajoute au modèle courant, même espace). Défaut : nouveau." },
      titre: { type: 'string', description: "Titre affiché dans le panneau. Défaut : « Modeleur »." },
      duree_ms: { type: 'number', description: `Durée de la pose, en millisecondes (défaut ${DUREE_DEFAUT_MS}, borné ${DUREE_MIN_MS}–${DUREE_MAX_MS}).` },
      relire: { type: 'boolean', description: 'true : ne dépose rien — renvoie les traits dessinés par-dessus le modèle par l\'utilisateur.' },
    },
    render: (_args, valeur) => [{ type: 'text', text: typeof valeur === 'string' ? valeur : JSON.stringify(valeur, null, 2) }],
    execute: async (brut, exec) => {
      const options = brut && typeof brut === 'object' ? brut : {}
      const sessionId = exec?.agent?.id
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        return { ok: false, raison: 'agent_inconnu', message: "impossible d'identifier la session courante (appel hors tour ?)" }
      }
      if (options.relire === true) {
        const etat = magasin.lire(sessionId)
        // lecture STRICTE : les traits d'une autre session ne nous regardent pas
        const ann = etat !== null && etat.sessionId === sessionId && etat.ann
          ? etat.ann
          : { version: 0, strokes: [] }
        const comptes = {}
        for (const t of ann.strokes) comptes[t.type] = (comptes[t.type] ?? 0) + 1
        const resume = Object.entries(comptes).map(([k, n]) => `${n} ${k}`).join(', ')
        return {
          ok: true,
          relire: true,
          titre: etat?.titre ?? '',
          espace: etat?.espace ?? '3d',
          version: etat?.version ?? 0,
          annotations: ann,
          message: ann.strokes.length > 0
            ? `${ann.strokes.length} annotation(s) par-dessus le modèle [${resume}] (coords x,y normalisées 0..1, origine coin haut-gauche${etat?.espace === '3d' ? ' ; caméra : yaw/pitch du panneau' : ''}). Lecture : rect/ellipse = entoure une zone, fleche = direction ou déplacement, texte = consigne littérale, trait libre = entourage ou biffure. Pousse ensuite un modèle ajusté avec mode « modifier ».`
            : "Aucun trait : l'utilisateur n'a pas redessiné par-dessus.",
        }
      }
      const enregistrement = magasin.pousser({
        sessionId,
        espace: espaceDe(options.espace),
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
        espace: enregistrement.espace,
        titre: enregistrement.titre,
        mode: enregistrement.mode,
        lots: Array.isArray(enregistrement.ops) ? enregistrement.ops.length : 0,
        duree_ms: enregistrement.dureeMs,
        message: Array.isArray(enregistrement.ops)
          ? `${enregistrement.ops.length} lot(s) déposés : le panneau « Modeleur » (barre latérale droite) les dessine en ${(enregistrement.dureeMs / 1000).toFixed(1)} s.`
          : 'Modèle déposé : le panneau « Modeleur » (barre latérale droite) le dessine maintenant.',
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
      espace: etat.espace,
      t0: etat.t0,
      dureeMs: etat.dureeMs,
      titre: etat.titre,
      prompt: etat.prompt,
      mode: etat.mode,
      ops: etat.ops,
      ann: etat.ann,
      serveur: Date.now(),
    })
  } })

  webServerSvc.register({ kind: 'exact', path: ROUTE_PUSH, handler: async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST uniquement'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    const corps = await lireCorps(req)
    const etat = magasin.pousser(corps)
    envoyer(res, 200, { ok: true, version: etat.version, espace: etat.espace, titre: etat.titre, dureeMs: etat.dureeMs })
  } })

  webServerSvc.register({ kind: 'exact', path: ROUTE_ANNOTE, handler: async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST uniquement'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    const corps = await lireCorps(req)
    const sessionId = typeof corps?.sessionId === 'string' ? corps.sessionId : ''
    const etat = magasin.annoter(sessionId, traitsPropres(corps?.strokes))
    if (etat === null) { envoyer(res, 200, { ok: false, raison: 'aucun_modele' }); return }
    envoyer(res, 200, { ok: true, annVersion: etat.ann.version, traits: etat.ann.strokes.length })
  } })

  dire(`routes ${ROUTE_STATE}, ${ROUTE_PUSH} et ${ROUTE_ANNOTE} enregistrées`)
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
