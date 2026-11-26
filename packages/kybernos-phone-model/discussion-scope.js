// ═══════════════════════════════════════════════════════════════════════════
// @local/kybernos-phone-model/discussion-scope — mounted by the « Discussion » preset INSIDE each chat that uses it (an agent scope, not the root).
//
// The engine's own tools (shell, files, web…) come from the preset's rows, and the « Discussion » preset has none. Two other kinds of tool reach every chat anyway:
//   · the tools of the Kybernos bundles (tables, automations, memory, MCP…), registered globally: every agent inherits them unless it narrows them;
//   · the nine team tools of the engine, registered in each chat's own scope because every chat leads a team.
// The small model on the phone takes no tools (the app's server answers 400 `tools_not_supported` to a request that has some), so for THIS chat only:
//   1. `tools.restrict({ allow: [] })` keeps no global tool (every engine of the 0.2 line);
//   2. the model is told about no tool at all, team tools included, so the request has no `tools`. Two engines, two seams, picked by what the registry offers:
//      · 0.2.2 and later have `tools.setExecutor`: this scope mounts its own executor, which describes nothing and hands every batch to the deployment's executor;
//      · 0.2.1-rc.2 (the engine the phone ships) has no executor seam, and builds the request from the assembly of the system prompt: a `system-prompt/assemble`
//        listener of this scope empties the `tools` of that assembly. (On 0.2.2 that listener would change nothing: the request is built from the executor.)
//   3. `tools.guard` denies every call, so a call the small model makes up out of thin air is refused with one sentence instead of running a tool.
// Other chats keep every tool: the steps live and die with this chat's scope.
//
// If the engine changes and a step cannot be put, the chat still starts: the app's server then answers `tools_not_supported` and the page shows it.
// ═══════════════════════════════════════════════════════════════════════════
export const name = 'kybernos-phone-model-discussion-scope'
export const inject = ['tools']

/** The sentence a made-up call is answered with. */
export const DENIED = 'This chat has no tools. Answer in plain text.'

const log = (what, e) => { try { console.log('[kybernos-phone-model] ' + what + ': ' + String(e && e.message ? e.message : e).slice(0, 160)) } catch (e2) { /* no console */ } }

/** 0.2.2 and later: the executor of this scope describes nothing to the model; a batch (only a made-up call can reach it) goes to the deployment's executor, where the guard refuses it. */
export function emptyExecutor(tools) {
  return {
    describe: () => ({ schemas: [] }),
    execute: (input) => tools.selectExecutor().execute(input),
  }
}

/** 0.2.1-rc.2: the assembly the request is built from keeps its prompt and loses its tools. */
export const withoutTools = async (_assembly, _context, next) => ({ ...(await next()), tools: [] })

export function apply(ctx) {
  try {
    const tools = ctx.tools
    const step = (what, fn) => { try { ctx.effect(fn, 'kybernos-phone-model: the Discussion chat ' + what) } catch (e) { log('a step failed (the Discussion chat ' + what + ')', e) } }
    step('sees no global tool', () => tools.restrict({ allow: [] }))
    if (typeof tools.setExecutor === 'function') step('describes no tool to the model', () => tools.setExecutor(emptyExecutor(tools)))
    else step('describes no tool to the model (assembly)', () => ctx.on('system-prompt/assemble', withoutTools))
    step('refuses every call', () => tools.guard(() => DENIED))
  } catch (e) {
    log('the Discussion chat keeps its tools', e)
  }
}
