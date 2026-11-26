// ═══════════════════════════════════════════════════════
// fabriquer-provider.mjs — factory of home-made one-shot providers.
//
// Wraps the DSH bridge (Provider class + apply + settleRunResult + subprocessRunHandle) so that a CLI that "runs once and
// writes on stdout" (gemini -p, qwen -p, opencode run, hermes -z…) becomes a declaration of a few lines.
//
// Usage — in <dsh-subagent-cli>/index.js:
//   export { name, inject, Config, apply } = fabriquerProvider({
//     nomModule: 'subagent-gemini', produit: 'Gemini CLI', bin: 'gemini',
//     argv: (bin, model, taches) => [bin, '-p', ...model ? ['-m', model] : [], taches.join('\n\n')],
//   })
// No model is hard-coded: `model` is optional and left to the native product.
//
// The engine modules it needs come from moteur.mjs (looked up from where the running DSH is), not from a node_modules next
// to this file: this package ships without one. The lookup is a top-level await, so a DSH without the engine's modules
// reports a plugin that failed to load, with the places it looked in.
// ═══════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto'
import { chargerMoteur } from './moteur.mjs'
import { runOneShot, texteTache, RunFailure } from './noyau.mjs'

const { subagent, subprocess, brand, z } = await chargerMoteur()
const { NO_START_CAPABILITIES, resolveChildCwd, settleRunResult, subprocessRunHandle } = subagent
const { scrubbedParentEnv } = subprocess
const { brandString } = brand

const DEFAULT_DISPOSE_GRACE_MS = 3000

/**
 * spec : { nomModule, produit, bin, argv(bin, model, taches) -> argv, defautNom?, envCle?, varEnvCle?, resoudreModel? }
 * Returns { name, inject, Config, apply }, ready to be exported by the provider.
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

    async start (request) {
      const parentCwd = request.parent.session.header.cwd
      if (parentCwd === undefined) throw new Error(`${spec.produit}: no working folder for the child — delegate from a session that has one`)
      let cwd
      try {
        cwd = resolveChildCwd(spec.nomModule, undefined, parentCwd)
      } catch (error) {
        if (request.signal.aborted) throw new Error(`${spec.produit}: request cancelled before the launch`)
        throw new RunFailure(spec.produit, { stage: 'exec', categorie: 'unknown' }, error)
      }

      const taches = texteTache(request.prompt)
      // Which model: the config first; otherwise the provider's optional hook
      // (Hermes discovers a `:free` model — none is ever hard-coded).
      let model = this.config.model
      if ((model == null || model === '') && typeof spec.resoudreModel === 'function') {
        model = await spec.resoudreModel({ baseUrl: this.config.baseUrl, env: this.config.env })
      }
      const argv = spec.argv(this.config.bin, model, taches, { apiKey: this.config.apiKey, baseUrl: this.config.baseUrl })
      const env = { ...scrubbedParentEnv(), ...this.config.env }
      // The API key also goes in the environment (under spec.varEnvCle) for the CLIs that read it there (gemini reads
      // GEMINI_API_KEY): scrubbedParentEnv removed the secrets, so ours is put back explicitly.
      if (spec.varEnvCle != null && this.config.apiKey) env[spec.varEnvCle] = this.config.apiKey
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
            this.ctx.logger.warn(`${spec.produit} "${this.name}": run failed: ${diagnostic}`)
            throw error
          }
        },
        collectOutput: () => [],
        collectDiagnostic: () => diagnostic,
        cancelled: () => request.signal.aborted,
        onError: (error, stopReason) => {
          this.ctx.logger.warn(`${spec.produit} "${this.name}": run failed (${stopReason}): %o`, error)
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
    // Key and endpoint: the config carries them when it has them; otherwise the provider's environment is read (spec.envCle =
    // variable names tried in order). The key lives outside git (~/.dsh/.credentials.yaml, injected in the environment at
    // launch), never in the code — so a key stored while DSH runs reaches a provider at the next DSH start.
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
