// ═══════════════════════════════════════════════════════════════════════════
// kybernos-slides — moitié HÔTE.
//
// Depuis le chat DSH, l'agent dépose un DECK de slides ; le panneau « Slides »
// (barre latérale droite) l'écrit en TEMPS RÉEL — machine à écrire, slide
// après slide. L'utilisateur modifie en direct (texte, pinceau) ; l'agent
// relit ces annotations et pousse une CORRECTION que le panneau souligne.
//
// Contrat (même forme que kybernos-bricks / kybernos-modeleur) :
//   1. un OUTIL (`creer_slides`) que l'agent appelle depuis le chat ;
//   2. trois ROUTES pour la moitié CLIENT :
//        GET  /kybernos-slides/state → deck + annotations de la session
//        POST /kybernos-slides/push  → deck (agent, via l'outil) ou
//                                      annotations (utilisateur, via client)
//
// DEUX MAGASINS : le deck (ce que l'agent écrit) et les annotations (ce que
// l'utilisateur a modifié/dessiné). Une correction (`mode: corriger`) remplace
// le deck mais GARDE les annotations, sauf `effacer_annotations: true`.
// Un appel de l'outil SANS `slides` ne dépose rien : il rend le deck courant
// plus les annotations — c'est ainsi que l'agent lit les retouches live.
//
// Aucun import statique de `@deepseek-ai/*` : un plugin lié en `@local/…` n'a
// pas ces paquets dans sa portée. `defineTool` est résolu paresseusement, avec
// un repli littéral (même schéma que kybernos-bricks et kybernos-modeleur).
// ═══════════════════════════════════════════════════════════════════════════

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'kybernos-slides'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const OUTIL = 'creer_slides'
const ROUTE_STATE = '/kybernos-slides/state'
const ROUTE_PUSH = '/kybernos-slides/push'
const DUREE_DEFAUT_MS = 12_000
const DUREE_MIN_MS = 2_000
const DUREE_MAX_MS = 120_000
const SLIDES_MAX = 60
const EDITS_MAX = 400

const dire = (msg) => console.log(`[kybernos-slides] ${msg}`)

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

const THEMES = new Set(['sombre', 'clair', 'corail', 'papier'])
const themeDe = (v) => (THEMES.has(v) ? v : 'sombre')

function texte (valeur, max) {
  if (typeof valeur !== 'string') return ''
  const propre = valeur.replace(/[ \t\n]+/g, ' ').trim()
  return propre.length > max ? propre.slice(0, max) : propre
}

function bornement (valeur) {
  const n = Number(valeur)
  if (!Number.isFinite(n) || n <= 0) return DUREE_DEFAUT_MS
  return Math.min(DUREE_MAX_MS, Math.max(DUREE_MIN_MS, Math.round(n)))
}

/** Normalise une slide : champs connus, chaînes bornées, layout connu. */
export function normaliserSlide (brut) {
  if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) return null
  const LAYOUTS = new Set(['titre', 'statement', 'puces', 'chiffre', 'citation', 'fin'])
  const layout = LAYOUTS.has(brut.layout) ? brut.layout : 'puces'
  const slide = { layout }
  for (const champ of ['kicker', 'titre', 'sous', 'grand', 'legende', 'citation', 'auteur', 'note']) {
    const v = texte(brut[champ], champ === 'titre' || champ === 'citation' ? 300 : 160)
    if (v !== '') slide[champ] = v
  }
  if (Array.isArray(brut.points)) {
    slide.points = brut.points
      .map((p) => texte(p, 220))
      .filter((p) => p !== '')
      .slice(0, 10)
  }
  if (typeof brut.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(brut.accent)) slide.accent = brut.accent
  return slide
}

// ── le magasin : deck + annotations, une paire par session ──────────────────
export function creerMagasin () {
  const decks = new Map()
  const annotations = new Map()
  let compteur = 0
  return {
    /** Dépose un deck ; rend l'enregistrement complet. */
    pousserDeck (entree) {
      const sessionId = typeof entree?.sessionId === 'string' && entree.sessionId.length > 0
        ? entree.sessionId
        : 'sans-session'
      const precedente = decks.get(sessionId)
      const maintenant = Date.now()
      const enregistrement = {
        version: (precedente?.version ?? 0) + 1,
        global: ++compteur,
        sessionId,
        t0: maintenant,
        dureeMs: bornement(entree?.dureeMs ?? entree?.duree_ms),
        titre: texte(entree?.titre, 120) || 'Slides',
        theme: themeDe(entree?.theme ?? precedente?.theme),
        prompt: texte(entree?.prompt, 2000),
        mode: entree?.mode === 'corriger' && precedente ? 'corriger' : 'nouveau',
        // Le deck précédent voyage avec la correction : le diff des passages
        // modifiés survit à un rechargement de page (mémoire client vide).
        precedente: precedente?.slides ?? null,
        effacerAnnotations: entree?.effacer_annotations === true,
        slides: Array.isArray(entree?.slides)
          ? entree.slides.map(normaliserSlide).filter(Boolean).slice(0, SLIDES_MAX)
          : [],
        pose: maintenant,
      }
      decks.set(sessionId, enregistrement)
      if (enregistrement.effacerAnnotations) {
        const a = annotations.get(sessionId)
        if (a) { a.strokes = []; a.efface = maintenant; a.version += 1 }
      }
      return enregistrement
    },
    /** Fusionne les annotations utilisateur (éditions de texte + traits). */
    pousserAnnotations (entree) {
      const sessionId = typeof entree?.sessionId === 'string' && entree.sessionId.length > 0
        ? entree.sessionId
        : 'sans-session'
      const a = annotations.get(sessionId) || { version: 0, edits: [], strokes: [], efface: 0 }
      a.version += 1
      if (Array.isArray(entree?.edits)) {
        for (const e of entree.edits.slice(0, 50)) {
          if (e === null || typeof e !== 'object') continue
          const slide = Number(e.slide)
          const champ = texte(e.champ, 24)
          const apres = texte(e.apres, 400)
          if (!Number.isInteger(slide) || champ === '') continue
          a.edits.push({
            slide,
            champ,
            idx: Number.isInteger(e.idx) ? e.idx : -1,
            avant: texte(e.avant, 400),
            apres,
            // Retouche de couleur (Google-Slides-like) : "#rgb"/"#rrggbb" seul.
            couleur: /^#[0-9a-fA-F]{3,8}$/u.test(String(e.couleur ?? '')) ? String(e.couleur) : undefined,
            t: Date.now(),
          })
        }
        if (a.edits.length > EDITS_MAX) a.edits = a.edits.slice(-EDITS_MAX)
      }
      if (entree && typeof entree.strokes === 'object' && entree.strokes !== null) {
        // Remplacement complet des traits d'une slide (le client renvoie la
        // liste à jour après chaque trait posé ou gommé).
        for (const [cle, liste] of Object.entries(entree.strokes)) {
          const slide = Number(cle)
          if (!Number.isInteger(slide) || slide < 0 || slide >= SLIDES_MAX) continue
          a.strokes = a.strokes.filter((s) => s.slide !== slide)
          if (Array.isArray(liste)) {
            for (const s of liste.slice(0, 200)) {
              if (s === null || typeof s !== 'object' || !Array.isArray(s.points)) continue
              const points = s.points
                .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
                .slice(0, 600)
                .map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10])
              if (points.length < 2) continue
              a.strokes.push({
                slide,
                points,
                color: typeof s.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : '#F2C31A',
                width: Number.isFinite(s.width) ? Math.min(24, Math.max(1, s.width)) : 3,
              })
            }
          }
        }
      }
      annotations.set(sessionId, a)
      return { ...a }
    },
    deck (sessionId) {
      if (typeof sessionId === 'string' && sessionId.length > 0 && decks.has(sessionId)) {
        return decks.get(sessionId)
      }
      return derniere(decks)
    },
    annotations (sessionId) {
      const cle = (typeof sessionId === 'string' && sessionId.length > 0 && annotations.has(sessionId))
        ? sessionId
        : derniereCle(annotations, decks)
      if (cle === null) return null
      return annotations.get(cle) || null
    },
    sessions () { return [...decks.keys()] },
  }
}

function derniere (map) {
  let meilleur = null
  for (const valeur of map.values()) if (meilleur === null || valeur.global > meilleur.global) meilleur = valeur
  return meilleur
}

function derniereCle (annotations, decks) {
  const deck = derniere(decks)
  return deck ? deck.sessionId : null
}

// ── l'outil ─────────────────────────────────────────────────────────────────

export function optionsOutil (magasin) {
  return {
    name: OUTIL,
    description:
      'Écrit un deck de slides dans la barre latérale droite du chat (panneau « Slides »), '
      + 'texte tapé en TEMPS RÉEL, slide après slide. L\'utilisateur peut modifier en live '
      + '(retaper un texte, dessiner au pinceau) ; relis ses annotations en rappelant l\'outil '
      + 'SANS `slides`, puis pousse une correction avec `mode: "corriger"` — le panneau souligne '
      + 'en direct chaque passage corrigé. '
      + 'Slide : {layout:"titre"|"statement"|"puces"|"chiffre"|"citation"|"fin", '
      + 'kicker, titre, sous, points:[…], grand, legende, citation, auteur, note, accent}. '
      + 'Thèmes : sombre (défaut), clair, corail, papier. Un appel sans `slides` rend le deck '
      + 'courant avec les annotations utilisateur (éditions + traits) au lieu d\'écrire.',
    parameters: {
      titre: { type: 'string', description: 'Titre du deck — affiché en en-tête et dans le pied de chaque slide.' },
      theme: { type: 'string', description: '« sombre » (défaut), « clair », « corail » ou « papier ».' },
      slides: {
        type: 'array',
        description: "Les slides, dans l'ordre. Chaque élément : {layout, kicker, titre, sous, points, grand, legende, citation, auteur, note, accent}. Omettre pour LIRE le deck + annotations sans écrire.",
        items: { type: 'object', additionalProperties: true },
      },
      mode: { type: 'string', description: '« nouveau » (défaut) ou « corriger » : les textes modifiés par rapport au deck précédent sont soulignés en direct dans le panneau.' },
      effacer_annotations: { type: 'boolean', description: 'Avec mode « corriger » : efface aussi les traits dessinés par l\'utilisateur (défaut : conservés).' },
      duree_ms: { type: 'number', description: `Durée totale de l'écriture, en millisecondes (défaut ${DUREE_DEFAUT_MS}, borné ${DUREE_MIN_MS}–${DUREE_MAX_MS}).` },
      prompt: { type: 'string', description: 'Ce que le deck présente, en une phrase — affiché sous les slides. En correction, la consigne de correction.' },
    },
    render: (_args, valeur) => [{ type: 'text', text: typeof valeur === 'string' ? valeur : JSON.stringify(valeur, null, 2) }],
    execute: async (brut, exec) => {
      const options = brut && typeof brut === 'object' ? brut : {}
      const sessionId = exec?.agent?.id
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        return { ok: false, raison: 'agent_inconnu', message: "impossible d'identifier la session courante (appel hors tour ?)" }
      }

      // LECTURE : sans `slides`, rendre le deck + les annotations de la session.
      if (!Array.isArray(options.slides)) {
        const deck = magasin.deck(sessionId)
        const a = magasin.annotations(sessionId)
        if (deck === null) {
          return { ok: true, vide: true, message: 'Aucun deck pour cette session : dépose-le avec `slides`.' }
        }
        const parSlide = {}
        for (const s of a?.strokes ?? []) parSlide[s.slide] = (parSlide[s.slide] ?? 0) + 1
        return {
          ok: true,
          lecture: true,
          titre: deck.titre,
          theme: deck.theme,
          slides: deck.slides.length,
          deck,
          annotations: {
            version: a?.version ?? 0,
            edits: a?.edits ?? [],
            traits_par_slide: parSlide,
            traits_total: (a?.strokes ?? []).length,
          },
          message: `Deck « ${deck.titre} » (${deck.slides.length} slides). ${(a?.edits ?? []).length} retouche(s) de texte, ${(a?.strokes ?? []).length} trait(s) dessiné(s).`,
        }
      }

      // ÉCRITURE : déposer le deck.
      const enregistrement = magasin.pousserDeck({
        sessionId,
        titre: options.titre,
        theme: options.theme,
        slides: options.slides,
        mode: options.mode,
        effacer_annotations: options.effacer_annotations,
        dureeMs: options.duree_ms,
        prompt: options.prompt,
      })
      return {
        ok: true,
        version: enregistrement.version,
        sessionId,
        titre: enregistrement.titre,
        theme: enregistrement.theme,
        mode: enregistrement.mode,
        slides: enregistrement.slides.length,
        duree_ms: enregistrement.dureeMs,
        message: `${enregistrement.slides.length} slide(s) déposée(s) : le panneau « Slides » (barre latérale droite) les écrit en ${(enregistrement.dureeMs / 1000).toFixed(0)} s.`
          + (enregistrement.mode === 'corriger' ? ' Corrections soulignées en direct.' : ''),
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
    const session = u.searchParams.get('session')
    const deck = magasin.deck(session)
    if (deck === null) { envoyer(res, 200, { vide: true }); return }
    const a = magasin.annotations(session)
    envoyer(res, 200, {
      vide: false,
      version: deck.version,
      global: deck.global,
      sessionId: deck.sessionId,
      t0: deck.t0,
      dureeMs: deck.dureeMs,
      titre: deck.titre,
      theme: deck.theme,
      prompt: deck.prompt,
      mode: deck.mode,
      slides: deck.slides,
      precedent: deck.mode === 'corriger' ? deck.precedente : null,
      annotations: {
        version: a?.version ?? 0,
        edits: a?.edits ?? [],
        strokes: a?.strokes ?? [],
      },
      serveur: Date.now(),
    })
  } })

  webServerSvc.register({ kind: 'exact', path: ROUTE_PUSH, handler: async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST uniquement'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    const corps = await lireCorps(req)
    if (corps && typeof corps === 'object' && (Array.isArray(corps.edits) || (corps.strokes && typeof corps.strokes === 'object'))) {
      const a = magasin.pousserAnnotations(corps)
      envoyer(res, 200, { ok: true, annotations: { version: a.version, edits: a.edits.length, strokes: a.strokes.length } })
      return
    }
    // Ni annotations ni slides : un corps illisible ne doit pas déposer un
    // deck fantôme (« Slides », zéro slide) qui écraserait le vrai.
    if (!corps || typeof corps !== 'object' || !Array.isArray(corps.slides)) {
      envoyer(res, 400, { ok: false, raison: 'corps_illisible', message: 'POST /push attend des slides (deck) ou des edits/strokes (annotations).' })
      return
    }
    const deck = magasin.pousserDeck(corps)
    envoyer(res, 200, { ok: true, version: deck.version, titre: deck.titre, dureeMs: deck.dureeMs })
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
