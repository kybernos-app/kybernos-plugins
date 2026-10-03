// ── Auto-continue : reprendre un tour coupé par la limite de tokens de sortie ─
//
// REMPLACE `scripts/patch-dsh-auto-continue.mjs` — aucune écriture dans les
// paquets DSH. Le moteur offre déjà tout ce qu'il faut (mesuré sur
// 0.2.0-rc.2, `dsh-agent-loop/lib/index.js`) :
//
//   · quand un pas se termine sur `max-tokens`, la boucle ferme le tour et
//     JOURNALISE `turn/end` avec `reason: { kind: "max-tokens" }` ;
//   · `Agent#followup(message)` « met en file un tour ordinaire et réveille le
//     pilote » ; et le tour qui se ferme relit son inbox (`if (!this.inbox
//     .hasPending) return false`) : un message déposé juste après `turn/end`
//     enchaîne donc le tour suivant sans que personne n'écrive « continue ».
//
// Différence avec le patch : le patch prolongeait LE MÊME tour (même numéro),
// le plugin ouvre un tour de plus — c'est exactement ce que fait l'utilisateur
// quand il tape « continue » à la main, que la GUI lui suggère (« Output token
// limit reached … Send "continue" »).
//
// Garde-fous (hérités du patch) :
//   · au plus KYBERNOS_AUTO_CONTINUE_MAX reprises à la suite (défaut 3 ; `0`,
//     une valeur négative ou non numérique désactive) ;
//   · rien n'est injecté si l'inbox a déjà du travail en attente (un message de
//     l'utilisateur en file passe avant) ;
//   · le compteur repart de zéro dès qu'un tour se ferme autrement, ou dès
//     qu'un message d'ORIGINE UTILISATEUR (autre que le nôtre) entre dans
//     l'inbox.
//
// Aucun import `@deepseek-ai/*` (un plugin `@local/…` ne les résout pas) : le
// message est construit à la main, à l'identique de `createUserMessage`
// (`dsh-llm` : `{ ...input, role, id: brandString(randomUUID()) }`, gelé ;
// `brandString` est l'identité à l'exécution).

import { randomUUID } from 'node:crypto'

export const VARIABLE_PLAFOND = 'KYBERNOS_AUTO_CONTINUE_MAX'
export const PLAFOND_DEFAUT = 3
export const TEXTE_REPRISE = 'continue'

/**
 * Plafond de reprises à la suite, lu dans l'environnement À CHAQUE FOIS (un
 * changement de variable n'exige pas de relance).
 * @param {Record<string, string|undefined>} [env]
 * @returns {number} entier ≥ 0 ; 0 = désactivé.
 */
export function plafondDepuisEnv (env = process.env) {
  const brut = env?.[VARIABLE_PLAFOND]
  if (brut === undefined) return PLAFOND_DEFAUT
  const n = Number.parseInt(String(brut), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Un message utilisateur gelé, de forme identique à `createUserMessage`. */
export function creerMessageReprise () {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text: TEXTE_REPRISE })]),
    source: Object.freeze({ kind: 'user' }),
  })
}

/**
 * Installe l'écoute. `ctx` doit porter `agents` (registre) ; les événements
 * `session/event`, `agent/inbox/inserted` et `agent/disposed` sont ceux du
 * moteur (typés dans `@deepseek-ai/dsh-agent`).
 * @param {object} ctx contexte cordis du plugin hôte
 * @param {{env?: object, differer?: (fn: () => void) => void, log?: (m: string) => void}} [options]
 * @returns {{reprises: () => number, etat: (sessionId: string) => object|undefined}}
 */
export function installerAutoContinue (ctx, options = {}) {
  const env = options.env ?? process.env
  // `setImmediate` : on sort du `finally` de la boucle qui vient d'écrire
  // `turn/end` avant de lui redonner du travail.
  const differer = options.differer ?? ((fn) => { setImmediate(fn) })
  const log = options.log ?? ((m) => console.log('[kybernos-flow] ' + m))

  /** sessionId → { chaine: reprises consécutives, siens: ids de nos messages } */
  const etats = new Map()
  let total = 0
  const etatDe = (sessionId) => {
    let e = etats.get(sessionId)
    if (e === undefined) { e = { chaine: 0, siens: new Set() }; etats.set(sessionId, e) }
    return e
  }

  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    try {
      const e = etatDe(agent.id)
      if (e.siens.delete(message.id)) return
      if (message.source?.kind === 'user') e.chaine = 0
    } catch { /* un écouteur ne doit jamais faire tomber la boucle */ }
  })

  ctx.on('agent/disposed', ({ agent }) => { try { etats.delete(agent.id) } catch { /* idem */ } })

  ctx.on('session/event', (session, event) => {
    try {
      if (event?.type !== 'turn/end') return
      const e = etatDe(session.id)
      if (event.data?.reason?.kind !== 'max-tokens') { e.chaine = 0; return }
      const plafond = plafondDepuisEnv(env)
      if (plafond === 0 || e.chaine >= plafond) return
      const agent = ctx.get('agents')?.get(session.id)
      if (agent === undefined) return
      e.chaine += 1
      const message = creerMessageReprise()
      e.siens.add(message.id)
      differer(() => {
        try {
          // Du travail est arrivé entre-temps (message en file, steering) : il passe avant.
          if (agent.inbox?.hasPending === true) { e.siens.delete(message.id); e.chaine -= 1; return }
          agent.followup(message)
          total += 1
          log('tour coupé par la limite de sortie — reprise automatique ' + e.chaine + '/' + plafond + ' (session ' + session.id + ')')
        } catch (erreur) {
          e.siens.delete(message.id)
          log('reprise impossible (session ' + session.id + ') : ' + String(erreur?.message ?? erreur))
        }
      })
    } catch { /* idem */ }
  })

  return { reprises: () => total, etat: (sessionId) => etats.get(sessionId) }
}
