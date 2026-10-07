// ═══════════════════════════════════════════════════════
// noyau.mjs — kit commun des providers maison de sous-agents DSH.
//
// Un provider maison pilote une CLI agentique externe (opencode, gemini, qwen,
// hermes…) en one-shot : spawn le binaire avec le prompt en argument/entrée,
// capture la sortie texte, la renvoie comme résultat de run, et expose un
// health-check pour le routeur Auto.
//
// Ce module ne dépend pas de @deepseek-ai/* : il est testable sans DSH. C'est
// le provider (dsh-subagent-<cli>/index.js) qui le branche sur le seam
// `ctx.subagents` + `ctx.subprocess` de DSH.
//
// Contrat d'un provider maison (calqué sur @deepseek-ai/dsh-subagent-codex) :
//   name, capabilities (NO_START_CAPABILITIES), start(request) ->
//     subprocessRunHandle({ id, result, signal, onAbort, requestCancel, teardown })
//   avec result = settleRunResult({ attempt, collectOutput, collectDiagnostic,
//     cancelled, onError, signal, onAbort }) et attempt() résolvant
//     { output: [{type:'text',text}], stopReason:'completed' }.
// ═══════════════════════════════════════════════════════

import { execFile } from 'node:child_process'
import { statSync, accessSync, constants } from 'node:fs'

/** Un seul nom de produit dans les diagnostics — jamais un modèle/provider en dur. */
export const diagnostique = (produit, fait) => {
  const champs = [`produit: ${produit}`]
  if (fait.stage) champs.push(`étape: ${fait.stage}`)
  if (fait.categorie) champs.push(`catégorie: ${fait.categorie}`)
  if (fait.code != null) champs.push(`code de sortie: ${fait.code}`)
  if (fait.signal != null) champs.push(`signal: ${fait.signal}`)
  return `Échec sous-agent produit (${champs.join(' ; ')})`
}

/** Erreur typée d'un run de provider maison (message sans détail sensible). */
export class RunFailure extends Error {
  constructor (produit, fait, cause) {
    super(diagnostique(produit, fait), cause === undefined ? undefined : { cause })
    this.name = 'RunFailure'
    this.fait = fait
  }
}

/** Valide qu'une tâche one-shot ne contient que du texte non vide. */
export function texteTache (prompt) {
  if (!Array.isArray(prompt) || prompt.length === 0) throw new Error('la tâche one-shot doit contenir des blocs de texte')
  const textes = []
  for (const bloc of prompt) {
    if (bloc == null || bloc.type !== 'text' || typeof bloc.text !== 'string') throw new Error('la tâche one-shot doit contenir uniquement des blocs texte')
    textes.push(bloc.text)
  }
  if (textes.every((t) => t.trim() === '')) throw new Error('la tâche one-shot ne doit pas être vide')
  return textes
}

/**
 * Trouve un exécutable dans le PATH (et nulle part ailleurs).
 * Retourne le chemin absolu ou null.
 */
export function trouverBinaire (binaire, env = process.env, plateforme = process.platform) {
  const exts = plateforme === 'win32' ? String(env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dossier of String(env.PATH || '').split(':')) {
    if (dossier === '') continue
    for (const ext of exts) {
      const candidat = `${dossier}/${binaire}${ext}`
      try {
        const st = statSync(candidat)
        if (st.isFile()) { accessSync(candidat, constants.X_OK); return candidat }
      } catch { /* suivant */ }
    }
  }
  return null
}

/**
 * Exécute une commande one-shot et renvoie la sortie complète.
 * Utilisé par le health-check (sonde du routeur) et les petits appels de
 * diagnostic — le run de délégation, lui, passe par `ctx.subprocess` de DSH.
 */
export function executer (binaire, args, { delaiMs = 30000, cwd, env } = {}) {
  return new Promise((resolve) => {
    try {
      execFile(binaire, args, { timeout: delaiMs, maxBuffer: 8 * 1024 * 1024, cwd, env: env ?? process.env, windowsHide: true }, (erreur, sortie, err) => {
        const texte = String(sortie ?? '') + String(err ?? '')
        if (!erreur) return resolve({ code: 0, sortie: texte })
        if (erreur.code === 'ENOENT') return resolve({ code: 127, sortie: texte, absent: true })
        if (erreur.killed === true || erreur.signal === 'SIGTERM') return resolve({ code: 1, sortie: texte, delai: true })
        resolve({ code: typeof erreur.code === 'number' ? erreur.code : 1, sortie: texte })
      })
    } catch (e) {
      resolve({ code: 1, sortie: String(e && e.message ? e.message : e) })
    }
  })
}

/**
 * Health-check d'une CLI agentique : binaire présent + authentifié, sans
 * consommer l'abonnement (aucun appel de modèle). Renvoie un verdict stable
 * que la page Workers et le routeur Auto consomment.
 *
 * spec : { produit, binaire, versionArgs, authArgs, authOk(code, sortie) }
 */
export async function sonder (spec, env = process.env) {
  const chemin = await Promise.resolve(trouverBinaire(spec.binaire, env))
  if (chemin == null) return { pret: false, raison: 'binaire-absent', message: `${spec.binaire} introuvable dans le PATH` }
  const v = await executer(spec.binaire, spec.versionArgs ?? ['--version'], { env })
  const version = (v.sortie || '').trim().split('\n')[0]
  const a = await executer(spec.binaire, spec.authArgs ?? ['--version'], { env })
  const connecte = typeof spec.authOk === 'function' ? spec.authOk(a.code, a.sortie) : a.code === 0
  return {
    pret: connecte,
    raison: connecte ? 'pret' : 'non-connecte',
    chemin,
    version,
    message: connecte ? `${spec.produit} prêt` : `${spec.produit} : lancez l'authentification de la CLI dans un terminal`
  }
}

/**
 * Fabrique un run one-shot complet autour d'une CLI qui écrit le résultat sur
 * stdout puis sort (gemini -p, qwen -p, opencode run…). Passe par le
 * `spawn` de `ctx.subprocess` de DSH (managed-range) — jamais d'execFile local
 * pour le run de délégation.
 *
 * produit  : nom affiché dans les diagnostics (jamais un modèle en dur)
 * argv     : (tache) -> [binaire, ...args] — chaque CLI fournit ses arguments
 * spawn    : spec.spawn de DSH ({ argv, cwd, stdio, env, graceMs })
 *
 * Renvoie { result, requestCancel, onAbort, teardown } prêts pour
 * subprocessRunHandle.
 */
export function runOneShot (produit, argv, { spawn, cwd, env, signal, graceMs = 3000 } = {}) {
  let enfant
  try {
    enfant = spawn({ argv, cwd, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }, env: env ?? {}, graceMs })
  } catch (e) {
    throw new RunFailure(produit, { stage: 'exec', categorie: 'unknown' }, e instanceof Error ? e : new Error(String(e)))
  }
  const sortie = []
  const err = []
  enfant.stdout?.on('data', (c) => sortie.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
  enfant.stderr?.on('data', (c) => err.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
  let annule = false
  const requestCancel = () => { annule = true; enfant.terminate() }
  const onAbort = () => requestCancel()
  if (signal != null) signal.addEventListener('abort', onAbort, { once: true })

  // `ctx.subprocess.spawn` renvoie un SubprocessHandle : .done résout les exit
  // facts ({exitCode, signal}), .terminate() démarre l'arrêt du managed-range.
  const issue = Promise.resolve(enfant.done)

  const attempt = async () => {
    const outcome = await issue.catch((e) => { throw new RunFailure(produit, { stage: 'exec', categorie: 'unknown' }, e) })
    const texte = Buffer.concat(sortie).toString('utf8').trim()
    const erreurTxt = Buffer.concat(err).toString('utf8').trim()
    const code = outcome?.exitCode
    const sig = outcome?.signal ?? null
    if (annule) throw new RunFailure(produit, { stage: 'exec', categorie: 'limit' })
    if (sig != null || code !== 0) throw new RunFailure(produit, { stage: 'exec', categorie: sig != null ? 'process' : 'product-error', code: code ?? undefined, signal: sig })
    const rendu = (texte !== '' ? texte : erreurTxt)
    return { output: [{ type: 'text', text: rendu === '' ? '(sortie vide)' : rendu }], stopReason: 'completed' }
  }
  const teardown = async () => {
    enfant.terminate()
    try { await enfant.waitForExit() } catch { /* best effort */ }
    try { await issue } catch { /* l'issue en échec est déjà reflétée dans attempt */ }
  }
  return { attempt, requestCancel, onAbort, teardown, enfant }
}
