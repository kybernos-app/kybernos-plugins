// ═══════════════════════════════════════════════════════
// fabriquer-provider.mjs — fabrique de providers maison one-shot.
//
// Encapsule le pont DSH (Provider class + apply + settleRunResult +
// subprocessRunHandle) pour qu'une CLI « one-shot qui écrit sur stdout »
// (gemini -p, qwen -p, opencode run…) devienne une déclaration de quelques
// lignes. OpenCode, Gemini, Qwen partagent cette façade ; Hermes (serve) aura
// la sienne.
//
// Usage — dans <dsh-subagent-cli>/index.js :
//   export { name, inject, Config, apply } = fabriquerProvider({
//     nomModule: 'subagent-gemini', produit: 'Gemini CLI', bin: 'gemini',
//     argv: (bin, model, taches) => [bin, '-p', ...model ? ['-m', model] : [], taches.join('\n\n')],
//   })
// Aucun modèle en dur : `model` est optionnel et déféré au produit natif.
// ═══════════════════════════════════════════════════════

import z from '@deepseek-ai/schemastery'
import { NO_START_CAPABILITIES, resolveChildCwd, settleRunResult, subprocessRunHandle } from '@deepseek-ai/dsh-subagent'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { brandString } from '@deepseek-ai/dsh-brand'
import { randomUUID } from 'node:crypto'
import { runOneShot, texteTache, RunFailure } from './noyau.mjs'

const DEFAULT_DISPOSE_GRACE_MS = 3000

/**
 * spec : { nomModule, produit, bin, argv(bin, model, taches) -> argv, defautBin? }
 * Renvoie { name, inject, Config, apply } prêts à exporter par le provider.
 */
export function fabriquerProvider (spec) {
  const name = spec.nomModule
  const inject = ['subagents', 'subprocess']
  const Config = z.object({
    providerName: z.string().min(1).default(spec.defautNom ?? spec.bin),
    model: z.string().default(''),
    bin: z.string().min(1).default(spec.bin),
    apiKey: z.string().default(''),
    baseUrl: z.string().default(''),
    env: z.dict(z.string()).default({}),
    disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS)
  })

  class ProviderMaison {
    constructor (nom, ctx, config) {
      this.name = nom
      this.ctx = ctx
      this.config = config
      this.capabilities = NO_START_CAPABILITIES
      this.inheritsParentContext = false
    }

    start (request) {
      const parentCwd = request.parent.session.header.cwd
      if (parentCwd === undefined) throw new Error(`${spec.produit}: pas de dossier de travail pour l’enfant — déléguez depuis une session qui en a un`)
      let cwd
      try {
        cwd = resolveChildCwd(spec.nomModule, undefined, parentCwd)
      } catch (error) {
        if (request.signal.aborted) throw new Error(`${spec.produit}: requête annulée avant le lancement`)
        throw new RunFailure(spec.produit, { stage: 'exec', categorie: 'unknown' }, error)
      }

      const taches = texteTache(request.prompt)
      const argv = spec.argv(this.config.bin, this.config.model, taches, { apiKey: this.config.apiKey, baseUrl: this.config.baseUrl })
      const env = { ...scrubbedParentEnv(), ...this.config.env }
      const spawn = (spawnSpec) => this.ctx.subprocess.spawn(spawnSpec)

      const { attempt, requestCancel, onAbort, teardown } = runOneShot(spec.produit, argv, {
        spawn, cwd, env, signal: request.signal, graceMs: this.config.disposeGraceMs
      })

      let diagnostic
      const result = settleRunResult({
        attempt: async () => {
          try {
            return await attempt()
          } catch (error) {
            diagnostic = error instanceof RunFailure ? error.message : String(error && error.message ? error.message : error)
            this.ctx.logger.warn(`${spec.produit} "${this.name}": run en échec : ${diagnostic}`)
            throw error
          }
        },
        collectOutput: () => [],
        collectDiagnostic: () => diagnostic,
        cancelled: () => request.signal.aborted,
        onError: (error, stopReason) => {
          this.ctx.logger.warn(`${spec.produit} "${this.name}": run en échec (${stopReason}) : %o`, error)
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
    // Clé/endpoint : le config les porte s'il les a ; sinon on lit l'env du
    // provider (spec.envCle = noms de variables essayées dans l'ordre) — la clé
    // vit hors git (~/.dsh/.credentials.yaml injecté en env), jamais en dur.
    let apiKey = config.apiKey ?? ''
    if (apiKey === '' && Array.isArray(spec.envCle)) {
      for (const nom of spec.envCle) { const v = process.env[nom]; if (typeof v === 'string' && v !== '') { apiKey = v; break } }
    }
    const baseUrl = (config.baseUrl ?? '') !== '' ? config.baseUrl : (process.env[spec.envBaseUrl ?? ''] ?? spec.baseUrlDefaut ?? '')
    const resolved = {
      providerName: config.providerName ?? spec.defautNom ?? spec.bin,
      model: config.model,
      bin: config.bin ?? spec.bin,
      apiKey,
      baseUrl,
      env: config.env ?? {},
      disposeGraceMs: config.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS
    }
    ctx.subagents.registerProvider(new ProviderMaison(resolved.providerName, ctx, resolved))
  }

  return { name, inject, Config, apply }
}
