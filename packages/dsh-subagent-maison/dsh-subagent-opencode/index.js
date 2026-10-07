// ═══════════════════════════════════════════════════════
// dsh-subagent-opencode — provider maison de sous-agent DSH pour la CLI
// OpenCode (opencode run). Calqué sur @deepseek-ai/dsh-subagent-codex, mais
// en one-shot « CLI qui écrit sur stdout puis sort » (pas de protocole serveur).
//
// Aucun modèle n'est écrit en dur : le modèle se règle dans le produit natif
// (OpenCode) — la CLI choisit elle-même. Ici on ne fait que lancer la tâche et
// renvoyer sa sortie.
//
// Testable sans DSH : la logique de run vit dans ../noyau.mjs (runOneShot),
// ce fichier ne fait que le pont ctx.subagents + ctx.subprocess.
// ═══════════════════════════════════════════════════════

import { z } from 'zod'
import { NO_START_CAPABILITIES, resolveChildCwd, settleRunResult, subprocessRunHandle } from '@deepseek-ai/dsh-subagent'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { brandString } from '@deepseek-ai/dsh-brand'
import { randomUUID } from 'node:crypto'
import { runOneShot, texteTache, RunFailure, sonder } from '../noyau.mjs'

const name = 'subagent-opencode'
const inject = ['subagents', 'subprocess']
const DEFAULT_PROVIDER_NAME = 'opencode'
const PRODUIT = 'OpenCode'
const DEFAULT_DISPOSE_GRACE_MS = 3000

const Config = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  model: z.string().min(1).optional(), // optionnel : défère au réglage natif d'OpenCode
  bin: z.string().min(1).default('opencode'),
  env: z.dict(z.string()).default({}),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS)
})

/** Arguments du run one-shot. Le prompt part en dernier argument. */
function argvRun (bin, model, taches) {
  const argv = [bin, 'run']
  if (model != null && model !== '') argv.push('-m', model)
  argv.push('--dangerously-skip-permissions')
  argv.push(taches.join('\n\n'))
  return argv
}

class OpencodeProvider {
  constructor (nom, ctx, config) {
    this.name = nom
    this.ctx = ctx
    this.config = config
    this.capabilities = NO_START_CAPABILITIES
    this.inheritsParentContext = false
  }

  start (request) {
    const parentCwd = request.parent.session.header.cwd
    if (parentCwd === undefined) throw new Error('subagent-opencode: pas de dossier de travail pour l’enfant — déléguez depuis une session qui en a un')
    let cwd
    try {
      cwd = resolveChildCwd('subagent-opencode', undefined, parentCwd)
    } catch (error) {
      if (request.signal.aborted) throw new Error('subagent-opencode: requête annulée avant le lancement')
      throw new RunFailure(PRODUIT, { stage: 'exec', categorie: 'unknown' }, error)
    }

    const taches = texteTache(request.prompt)
    const argv = argvRun(this.config.bin, this.config.model, taches)
    const env = { ...scrubbedParentEnv(), ...this.config.env }
    const spawn = (spec) => this.ctx.subprocess.spawn(spec)

    const { attempt, requestCancel, onAbort, teardown } = runOneShot(PRODUIT, argv, {
      spawn, cwd, env, signal: request.signal, graceMs: this.config.disposeGraceMs
    })

    let diagnostic
    const result = settleRunResult({
      attempt: async () => {
        try {
          return await attempt()
        } catch (error) {
          diagnostic = error instanceof RunFailure ? error.message : String(error && error.message ? error.message : error)
          this.ctx.logger.warn(`subagent-opencode "${this.name}": run en échec : ${diagnostic}`)
          throw error
        }
      },
      collectOutput: () => [],
      collectDiagnostic: () => diagnostic,
      cancelled: () => request.signal.aborted,
      onError: (error, stopReason) => {
        this.ctx.logger.warn(`subagent-opencode "${this.name}": run en échec (${stopReason}) : %o`, error)
      },
      signal: request.signal,
      onAbort
    })

    return subprocessRunHandle({
      id: brandString(randomUUID()),
      result,
      signal: request.signal,
      onAbort,
      requestCancel,
      teardown
    })
  }
}

function apply (ctx, config) {
  const resolved = {
    providerName: config.providerName ?? DEFAULT_PROVIDER_NAME,
    model: config.model,
    bin: config.bin ?? 'opencode',
    env: config.env ?? {},
    disposeGraceMs: config.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS
  }
  ctx.subagents.registerProvider(new OpencodeProvider(resolved.providerName, ctx, resolved))
}

export { Config, apply, inject, name, sonder }
