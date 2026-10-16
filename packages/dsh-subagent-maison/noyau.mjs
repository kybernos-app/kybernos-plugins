// ═══════════════════════════════════════════════════════
// noyau.mjs — the common kit of the DSH sub-agent in-house providers.
//
// An in-house provider drives an external agentic CLI (opencode, gemini, qwen,
// hermes…) one-shot: it spawns the binary with the prompt as argument/input,
// captures the text output, returns it as the run result, and exposes a
// health check for the Auto router.
//
// This module does not depend on @deepseek-ai/*: it can be tested without DSH. It is
// the provider (dsh-subagent-<cli>/index.js) that plugs it into the
// `ctx.subagents` + `ctx.subprocess` seam of DSH.
//
// Contract of an in-house provider (modelled on @deepseek-ai/dsh-subagent-codex):
//   name, capabilities (NO_START_CAPABILITIES), start(request) ->
//     subprocessRunHandle({ id, result, signal, onAbort, requestCancel, teardown })
//   avec result = settleRunResult({ attempt, collectOutput, collectDiagnostic,
//     cancelled, onError, signal, onAbort }) and attempt() resolving
//     { output: [{type:'text',text}], stopReason:'completed' }.
// ═══════════════════════════════════════════════════════

import { execFile } from 'node:child_process'
import { statSync, accessSync, constants } from 'node:fs'

/** A single product name in the diagnostics — never a hard-coded model/provider. */
export const diagnostique = (produit, fait) => {
  const champs = [`product: ${produit}`]
  if (fait.stage) champs.push(`stage: ${fait.stage}`)
  if (fait.categorie) champs.push(`category: ${fait.categorie}`)
  if (fait.code != null) champs.push(`exit code: ${fait.code}`)
  if (fait.signal != null) champs.push(`signal: ${fait.signal}`)
  return `Subagent product failure (${champs.join('; ')})`
}

/** Typed error of an in-house provider run (message without sensitive detail). */
export class RunFailure extends Error {
  constructor (produit, fait, cause) {
    super(diagnostique(produit, fait), cause === undefined ? undefined : { cause })
    this.name = 'RunFailure'
    this.fait = fait
  }
}

/** Checks that a one-shot task holds nothing but non-empty text. */
export function texteTache (prompt) {
  if (!Array.isArray(prompt) || prompt.length === 0) throw new Error('the one-shot task must contain text blocks')
  const textes = []
  for (const bloc of prompt) {
    if (bloc == null || bloc.type !== 'text' || typeof bloc.text !== 'string') throw new Error('the one-shot task must contain text blocks only')
    textes.push(bloc.text)
  }
  if (textes.every((t) => t.trim() === '')) throw new Error('the one-shot task must not be empty')
  return textes
}

/**
 * Finds an executable in the PATH (and nowhere else).
 * Returns the absolute path or null.
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
 * Runs a one-shot command and returns the whole output.
 * Used by the health check (the router's probe) and the small diagnostic
 * calls — the delegation run itself goes through DSH's `ctx.subprocess`.
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
 * Discovers a free model (`…:free`) on an OpenAI-compatible catalogue
 * (/v1/models), at run time — never a hard-coded name (policy). Used by
 * Hermes, whose portal default is broken/paid. `choisir` breaks the tie when
 * there are several candidates. Returns an id or null.
 */
export async function trouverModeleFree (baseUrl, { choisir, env = process.env } = {}) {
  try {
    const r = await fetch(String(baseUrl).replace(/\/$/, '') + '/models', { headers: { accept: 'application/json' } })
    if (!r.ok) return null
    const d = await r.json()
    const ids = Array.isArray(d && d.data) ? d.data.map((m) => m && m.id).filter((x) => typeof x === 'string') : []
    const gratuits = ids.filter((i) => i.endsWith(':free'))
    if (gratuits.length === 0) return null
    return typeof choisir === 'function' ? choisir(gratuits) : gratuits[0]
  } catch { return null }
}

/**
 * Health check of an agentic CLI: binary present + authenticated, without
 * spending the subscription (no model call). Returns a stable verdict that
 * the Workers page and the Auto router consume.
 *
 * spec: { produit, binaire, versionArgs, authArgs, authOk(code, output) }
 */
export async function sonder (spec, env = process.env) {
  const chemin = await Promise.resolve(trouverBinaire(spec.binaire, env))
  if (chemin == null) return { pret: false, raison: 'binaire-absent', message: `${spec.binaire} not found in the PATH` }
  const v = await executer(spec.binaire, spec.versionArgs ?? ['--version'], { env })
  const version = (v.sortie || '').trim().split('\n')[0]
  const a = await executer(spec.binaire, spec.authArgs ?? ['--version'], { env })
  const connecte = typeof spec.authOk === 'function' ? spec.authOk(a.code, a.sortie) : a.code === 0
  return {
    pret: connecte,
    raison: connecte ? 'pret' : 'non-connecte',
    chemin,
    version,
    message: connecte ? `${spec.produit} ready` : `${spec.produit}: run the CLI's sign-in in a terminal`
  }
}

/**
 * Builds a complete one-shot run around a CLI that writes the result to
 * stdout and then exits (gemini -p, qwen -p, opencode run…). It goes through
 * DSH's `ctx.subprocess` `spawn` (managed-range) — never a local execFile
 * for the delegation run.
 *
 * produit  : name shown in the diagnostics (never a hard-coded model)
 * argv     : (task) -> [binary, ...args] — each CLI supplies its own arguments
 * spawn    : DSH's spec.spawn ({ argv, cwd, stdio, env, graceMs })
 *
 * Returns { result, requestCancel, onAbort, teardown } ready for
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

  // `ctx.subprocess.spawn` returns a SubprocessHandle: .done resolves the exit
  // facts ({exitCode, signal}), .terminate() starts the managed-range shutdown.
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
    try { await issue } catch { /* the failed outcome is already reflected in attempt */ }
  }
  return { attempt, requestCancel, onAbort, teardown, enfant }
}
