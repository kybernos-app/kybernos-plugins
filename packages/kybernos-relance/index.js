// ═══════════════════════════════════════════════════════════════════════════
// kybernos-relance — moitié hôte.
//
// DEUX rôles, un seul paquet :
//   1. CLIENT (`client.js`, inchangé) — recharge la page une fois quand l'hôte
//      redémarre (toutes les révisions du graphe changent) au lieu de laisser
//      l'interface noire ;
//   2. HÔTE (ce fichier) — expose l'outil `relancer_dsh`, le SEUL chemin propre
//      pour couper DSH quand d'autres sessions travaillent : il demande l'accord
//      par le PANEAU D'APPROBATION NATIF (`ctx.approval.request` →
//      `@deepseek-ai/dsh-client-ui-approval`), puis lance le script détaché
//      `~/.dsh/tools/dsh-relance.mjs`, qui journalise les sessions actives et
//      les réveille TOUTES après le redémarrage.
//
// POURQUOI UN OUTIL ET PAS SEULEMENT LE SCRIPT : `ctx.approval.request()` exige
// un TOUR OUVERT (le tour est la frontière de commit du journal). Un script
// lancé en bash ne peut pas ouvrir ce panneau ; un outil, si. Le script garde
// son propre refus (`relance` sans `--avec-autres` sort en 3), donc la garde
// tient même si l'outil est contourné.
//
// Aucun import statique de `@deepseek-ai/*` : un plugin lié en `@local/…` n'a
// pas ces paquets dans sa portée de résolution, et un import qui échoue ferait
// tomber le profil. `defineTool` est résolu paresseusement, avec un repli dont
// la forme est vérifiée par `test-host.mjs`.
// ═══════════════════════════════════════════════════════════════════════════

import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'kybernos-relance'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const SCRIPT_RELANCE = join(DSH_HOME, 'tools', 'dsh-relance.mjs')
const DELAI_DEFAUT_S = 20
const OUTIL = 'relancer_dsh'

const dire = (msg) => console.log(`[kybernos-relance] ${msg}`)

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

/**
 * Repli : la forme EXACTE que `defineTool` produit (vérifiée le 22/09/2026 sur
 * `dsh-tools` 0.1.7-alpha.1 — paramètres compilés, schéma de sortie `{}`).
 * @param options - nom, description, paramètres, render et execute.
 */
export function definitionLiteral (options) {
  return {
    name: options.name,
    description: options.description,
    parameters: { type: 'object', properties: options.parameters },
    output: {
      schema: {},
      render: (args, value) => options.render(args, value),
    },
    execute: options.execute,
  }
}

// ── services (tous facultatifs : on ne casse jamais le profil) ──────────────

function titreDe (row) {
  const v = row?.projections?.values
  if (typeof v?.title === 'string' && v.title.length > 0) return v.title
  return typeof row?.title === 'string' && row.title.length > 0 ? row.title : '(sans titre)'
}

/** Sessions qui tournent vraiment, hors enfant subagent et hors session courante. */
export function filtrerActives (items, sessionId) {
  return (Array.isArray(items) ? items : []).filter((row) => row && row.running === true
    && row.sessionId !== sessionId
    && row.origin !== 'subagent'
    && (row.parentSessionId === undefined || row.parentSessionId === null))
}

function sessionsActives (ctx, sessionId) {
  const controleur = ctx.get('sessionController')
  if (controleur === undefined || typeof controleur.list !== 'function') return undefined
  return Promise.resolve(controleur.list({}, AbortSignal.timeout(10_000)))
    .then((valeur) => filtrerActives(valeur?.items, sessionId))
}

/** Repli quand `sessionController` n'est pas monté : la CLI dit exactement la même chose. */
function sessionsActivesParScript (port) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT_RELANCE, 'actives', '--json', '--port', String(port)], {
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, DSH_HOME },
    }, (_erreur, stdout) => {
      try {
        const parse = JSON.parse(String(stdout ?? ''))
        resolve(Array.isArray(parse?.others) ? parse.others : undefined)
      } catch { resolve(undefined) }
    })
  })
}

function portCourant (ctx) {
  const serveur = ctx.get('webServer')
  const port = serveur?.port
  if (Number.isFinite(port) && port > 0) return port
  const envPort = Number(process.env.DSH_PORT)
  return Number.isFinite(envPort) && envPort > 0 ? envPort : 3080
}

/**
 * Politique d'approbation effective de la session de l'agent appelant.
 * `never` (preset plein accès) signifie que `approval.request()` rend « rejected »
 * sans jamais ouvrir de panneau : personne n'est consulté. Renvoie `null` quand
 * la question n'a pas de réponse sûre — on ne devine pas, on retombe sur le
 * comportement historique.
 */
export function politiqueApprobation (ctx, agent) {
  try {
    const approval = ctx.get('approval')
    const session = agent?.session
    if (approval === undefined || session === undefined || typeof approval.effectivePolicy !== 'function') return null
    const politique = approval.effectivePolicy(session)
    return typeof politique === 'string' ? politique : null
  } catch {
    return null
  }
}

// ── l'outil ─────────────────────────────────────────────────────────────────

export function optionsOutil (ctx) {
  return {
    name: OUTIL,
    description:
      "Redémarre le serveur DSH (chargement d'un plugin cordis, d'un profil, de réglages…) SANS perdre le travail : " +
      "les sessions qui tournent sont journalisées puis réveillées automatiquement après le redémarrage. " +
      "À utiliser au lieu d'un `dsh-relance.mjs relance` en bash. " +
      "Si d'autres sessions sont en cours, l'outil ouvre le panneau d'approbation natif : sans « Allow once », RIEN n'est coupé. " +
      "La coupure est faite par un processus détaché après `delai` secondes (le temps que ta réponse sorte) ; " +
      "l'outil rend la main tout de suite. Ne le rappelle pas pour vérifier : après le redémarrage, DSH réveille les sessions tout seul.",
    parameters: {
      motif: { type: 'string', description: 'Note laissée avant la relance : ce que tu faisais, pour que la session reprenne juste après le redémarrage.' },
      delai: { type: 'number', description: `Secondes avant la coupure (défaut ${DELAI_DEFAUT_S}, borné 5–300) : laisse sortir la réponse en cours.` },
    },
    render: (_args, valeur) => [{ type: 'text', text: typeof valeur === 'string' ? valeur : JSON.stringify(valeur, null, 2) }],
    execute: async (brut, exec) => {
      const options = brut && typeof brut === 'object' ? brut : {}
      const sessionId = exec?.agent?.id
      const port = portCourant(ctx)
      if (!existsSync(SCRIPT_RELANCE)) {
        return { coupe: false, raison: 'script_absent', message: `script introuvable : ${SCRIPT_RELANCE}` }
      }
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        return { coupe: false, raison: 'agent_inconnu', message: "impossible d'identifier la session courante (appel hors tour ?)" }
      }

      // 1. Qui tourne ? (natif : `session/list` porte `running`)
      let autres = sessionsActives(ctx, sessionId)
      if (autres !== undefined) {
        autres = await autres.catch((e) => { dire(`session/list a échoué : ${e?.message ?? e}`); return undefined })
      }
      if (autres === undefined) autres = await sessionsActivesParScript(port)
      if (autres === undefined) {
        return { coupe: false, raison: 'sessions_illisibles', message: "impossible de savoir si d'autres sessions travaillent — redémarrage refusé (échec fermé)" }
      }

      // 2. D'autres sessions tournent : panneau d'approbation natif.
      let approbation = null
      if (autres.length > 0) {
        const approval = ctx.get('approval')
        if (approval === undefined || typeof approval.request !== 'function') {
          return {
            coupe: false,
            raison: 'approbation_indisponible',
            sessions_actives: autres.map((row) => ({ sessionId: row.sessionId, titre: titreDe(row) })),
            message: `${autres.length} session(s) travaillent et aucun canal d'approbation n'est monté : je ne coupe rien. Préviens l'utilisateur.`,
          }
        }
        // Sous la politique « never » (preset plein accès), le service
        // d'approbation refuse AVANT tout answerer : `request()` rend
        // « rejected » sans que personne ait été consulté, et le panneau ne peut
        // pas paraître. Confondre ça avec un refus de l'utilisateur serait un
        // mensonge — on le dit séparément.
        const politique = politiqueApprobation(ctx, exec.agent)
        if (politique === 'never') {
          return {
            coupe: false,
            raison: 'politique_never',
            approbation: null,
            politique,
            sessions_actives: autres.map((row) => ({ sessionId: row.sessionId, titre: titreDe(row) })),
            message: `${autres.length} session(s) travaillent, mais la politique d'approbation de cette session est « never » `
              + '(preset plein accès) : le panneau ne peut pas s\'ouvrir et personne n\'a été consulté — rien n\'est coupé. '
              + 'Pour autoriser OU tester le panneau, passe la session en « ask » (preset « workspace-write » : /permission workspace-write), puis rappelle l\'outil.',
          }
        }
        approbation = await approval.request({
          agent: exec.agent,
          toolName: OUTIL,
          ...(exec.callId !== undefined ? { callId: exec.callId } : {}),
          reason: `Redémarrage de DSH alors que ${autres.length} autre(s) session(s) travaillent : `
            + autres.map((row) => `${titreDe(row)} (${row.sessionId})`).join(' · ')
            + '. Elles seront reprises automatiquement après le redémarrage.',
          ...(exec.signal !== undefined ? { signal: exec.signal } : {}),
        })
        if (approbation !== 'allowed-once') {
          return {
            coupe: false,
            raison: approbation,
            approbation,
            sessions_actives: autres.map((row) => ({ sessionId: row.sessionId, titre: titreDe(row) })),
            message: approbation === 'rejected'
              ? "L'utilisateur a refusé le redémarrage : rien n'a été coupé, les autres sessions continuent."
              : `Accord non obtenu (${approbation}) : rien n'a été coupé (échec fermé).`,
          }
        }
      }

      // 3. Accord obtenu (ou aucune autre session) : relance détachée.
      const delai = Math.min(300, Math.max(5, Number.isFinite(Number(options.delai)) && Number(options.delai) > 0 ? Number(options.delai) : DELAI_DEFAUT_S))
      const argv = [SCRIPT_RELANCE, 'relance', '--avec-autres', '--session', sessionId, '--delay', String(delai), '--port', String(port)]
      if (typeof options.motif === 'string' && options.motif.length > 0) argv.push('--motif', options.motif)
      try {
        const enfant = spawn(process.execPath, argv, { detached: true, stdio: 'ignore', env: { ...process.env, DSH_HOME } })
        enfant.unref()
        dire(`relance détachée (pid ${enfant.pid}) dans ${delai} s — ${autres.length} autre(s) session(s) seront reprises`)
        return {
          coupe: true,
          dans_secondes: delai,
          pid: enfant.pid,
          approbation,
          sessions_actives: autres.map((row) => ({ sessionId: row.sessionId, titre: titreDe(row) })),
          message: `Redémarrage de DSH dans ${delai} s ; ${autres.length + 1} session(s) (dont celle-ci) seront réveillées automatiquement. `
            + 'Termine ta réponse maintenant : le processus détaché coupe DSH et le relance.',
        }
      } catch (e) {
        return { coupe: false, raison: 'spawn_impossible', message: String(e?.message ?? e) }
      }
    },
  }
}

/**
 * Traduit l'intention (forme « spec » : `parameters` en carte, `render` à la
 * racine) en définition attendue par `defineTool` (`output.schema` + `render`).
 * @param options - nom, description, paramètres, render et execute.
 */
export function specDefineTool (options) {
  return {
    name: options.name,
    description: options.description,
    parameters: options.parameters,
    output: { schema: { type: 'json' }, render: (args, value) => options.render(args, value) },
    execute: options.execute,
  }
}

/** Enregistre l'outil sur un contexte qui porte déjà `tools`. */
export async function enregistrer (ctx) {
  const definition = optionsOutil(ctx)
  const chargement = await chargerDefineTool()
  let outil
  if (chargement !== undefined) {
    outil = chargement.defineTool(specDefineTool(definition))
  } else {
    dire('defineTool introuvable — définition littérale (forme compilée équivalente)')
    outil = definitionLiteral(definition)
  }
  ctx.tools.register(outil)
  dire(`outil « ${OUTIL} » enregistré`)
}

/** Le plugin hôte : un outil, rien d'autre (le client fait le rechargement de page). */
export function apply (ctx) {
  const demarrer = (c) => { enregistrer(c).catch((e) => dire(`outil non enregistré : ${e?.message ?? e}`)) }
  if (ctx.get('tools') !== undefined) demarrer(ctx)
  else ctx.inject(['tools'], demarrer)
}
