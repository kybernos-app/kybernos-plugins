// ═══════════════════════════════════════════════════════════════════════════
// @local/kybernos-phone-model/light-agent-scope — mounted by the « Light agent » preset INSIDE each chat that uses it (an agent scope, not the root).
// The counterpart of discussion-scope.js: that one empties the tool list, this one narrows it to four tools and puts the person's approval in front of the writes.
//
// What reaches a chat by default is far too much for a 4096-token window: the tools of every Kybernos bundle (registered globally, 80 and more on the phone's engine) and the
// nine team tools of the engine (registered in each chat's own scope). For THIS chat only:
//   1. `tools.restrict({ allow })` keeps the global tools of the light list that exist (an allow list with a name the engine does not hold fails, so the list is cut to the held names);
//   2. the model is told about the four tools only, each with the small schema of phone-model.mjs (`LIGHT_TOOLS`). Two engines, two seams, picked by what the registry offers:
//      · 0.2.2 and later have `tools.setExecutor`: this scope mounts an executor that describes the four and hands every batch to the deployment's executor;
//      · 0.2.1-rc.2 (the engine the phone ships) builds the request from the assembly of the system prompt: a `system-prompt/assemble` listener of this scope narrows its `tools`;
//   3. `tools.guard` and a `tools/pre-execute` listener refuse a call of any other tool (a call the model made up), and the listener answers `{ kind: 'ask' }` for a reminder,
//      which is the engine's own approval card (the two `*_suggest` tools wait for the person's « Add » by themselves). In the « Full access » mode the engine shows no card and
//      rejects the ask unseen, so the reminder is refused with a plain sentence instead (the model must not tell the person they refused);
//   4. a `tools/post-execute` listener cuts a long tool result (a document of the knowledge folder) to a size the 4096-token window can hold.
// NOT shrunk, measured on 0.2.1-rc.2: the engine adds two `required` runtime facts to every chat as one extra user message even with `includeRuntimeContext: false` (the working
// directory, and « You are the Team Lead named "lead". Use list_agents… send_message… », about 100 tokens). Taking them out of the prompt assembly does nothing (the engine puts the
// required ones back when it admits the request), and a context of the same name registered from here with no text is accepted and does nothing (measured on 0.2.1-rc.2 and 0.2.2-rc.1: the team plugin registers its entry in the AGENT's own scope, below this chat's scope, and it wins the name). Only the app's server can drop it (README).
// The guard answers a call to `list_agents` or `send_message` with the sentence naming the four tools.
// Other chats keep every tool: the steps live and die with this chat's scope. If the engine changes and a step cannot be put, the chat still starts: a step that failed is
// logged and the others are still put (the guard alone makes the chat safe: it denies what the model should not call).
// ═══════════════════════════════════════════════════════════════════════════
import { LIGHT_NAMES, bareContent, capContent, languageOf, lightAllows, lightGate, lightSchemas, localisedContent, personTexts, plainContent } from './phone-model.mjs'

export const name = 'kybernos-phone-model-light-agent-scope'
export const inject = ['tools']

/** The sentence a made-up call is answered with. */
export const DENIED = 'This chat can only use: ' + LIGHT_NAMES.join(', ') + '.'

const log = (what, e) => { try { console.log('[kybernos-phone-model] ' + what + ': ' + String(e && e.message ? e.message : e).slice(0, 160)) } catch (e2) { /* no console */ } }

/** 0.2.2 and later: the executor of this scope describes the four tools; a batch goes to the deployment's executor, where the guard refuses anything else. */
export function lightExecutor(tools) {
  return {
    describe: (definitions) => {
      const base = tools.selectExecutor().describe(Array.isArray(definitions) ? definitions.filter((d) => d !== null && typeof d === 'object' && lightAllows(d.name)) : definitions)
      return { ...base, schemas: lightSchemas(base.schemas) }
    },
    execute: (input) => tools.selectExecutor().execute(input),
  }
}

/** 0.2.1-rc.2: the assembly the request is built from keeps its prompt and its four tools, with their small schemas. */
export const withLightTools = async (_assembly, _context, next) => {
  const assembly = await next()
  return { ...assembly, tools: lightSchemas(assembly.tools) }
}

/** The names of the light list that the engine holds as global tools, so that `restrict` is never given a name it does not know. */
export function heldNames(tools) {
  try {
    const held = new Set(tools.definitions().map((d) => d.name))
    return LIGHT_NAMES.filter((n) => held.has(n))
  } catch (e) { return LIGHT_NAMES.slice() }
}

/** The approval policy of the chat a call belongs to: `'never'` (the « Full access » mode: the engine rejects every card unseen) or `'ask'`; a service or a session that cannot be read counts as `'ask'`. */
export function policyOf(ctx, exec) {
  try {
    const approval = ctx.get('approval')
    if (approval !== undefined && approval !== null && typeof approval.effectivePolicy === 'function') return approval.effectivePolicy(exec.agent.session) === 'never' ? 'never' : 'ask'
  } catch (e) { /* no service, no session: the card is asked for */ }
  return 'ask'
}

/** The last texts the person wrote in the chat a call belongs to (the engine's `session.deriveMessages()`), or `null` when the chat cannot be read: then the time guard does not judge. */
export function saidOf(exec) {
  try { return personTexts(exec.agent.session.deriveMessages(), 3) } catch (e) { return null }
}

/** `tools/pre-execute`: a card for a reminder (a refusal that says so when the chat's mode shows no card), a refusal for another tool, else the call goes on. */
export const preExecute = (ctx) => async (exec, next) => {
  try { const answer = lightGate(exec, policyOf(ctx, exec), saidOf(exec)); if (answer !== null) return answer } catch (e) { /* never break a call */ }
  return next()
}

/**
 * `tools/post-execute`: what the model reads back is made plain and short. An empty knowledge folder is one plain sentence, a result of the four tools (and the engine's « the user rejected tool »)
 * is worded in French when the person writes French (the real model followed the English of the result and answered a French ask in English), and a long result is cut. The refusals
 * of `lightGate` and a rejected card come through here too (the engine runs this listener on a denied call); the refusal for a reminder with no time loses the engine's « Error: » in any
 * language (`bareContent`: with it the model called the tool again). Anything else is accepted as it is.
 */
export const postExecute = async (exec, result, next) => {
  try {
    if (exec !== null && typeof exec === 'object' && lightAllows(exec.name) && result !== null && typeof result === 'object') {
      let content = result.content
      let changed = false
      if (result.isError === false) { const plain = plainContent(exec.name, content); if (plain !== null) { content = plain; changed = true } }
      const fr = localisedContent(exec.name, content, languageOf(saidOf(exec)))
      if (fr !== null) { content = fr; changed = true } else { const bare = bareContent(content); if (bare !== null) { content = bare; changed = true } }
      if (result.isError === false) { const cut = capContent(content); if (cut !== null) { content = cut; changed = true } }
      if (changed) return { kind: 'accept', content }
    }
  } catch (e) { /* never break a call */ }
  return next()
}

export function apply(ctx) {
  try {
    const tools = ctx.tools
    const step = (what, fn) => { try { ctx.effect(fn, 'kybernos-phone-model: the Light agent chat ' + what) } catch (e) { log('a step failed (the Light agent chat ' + what + ')', e) } }
    step('sees only the light tools', () => tools.restrict({ allow: heldNames(tools) }))
    if (typeof tools.setExecutor === 'function') step('describes the light tools to the model', () => tools.setExecutor(lightExecutor(tools)))
    else step('describes the light tools to the model (assembly)', () => ctx.on('system-prompt/assemble', withLightTools))
    // `prepend`: this chat's card, its time guard and its refusals come before the core plugin's own question for a reminder (which every chat has now), so the light chat is never asked twice or past its guard.
    step('asks before a reminder and refuses any other tool', () => ctx.on('tools/pre-execute', preExecute(ctx), { prepend: true }))
    step('refuses a made-up call', () => tools.guard((call) => (lightAllows(call && call.name) ? undefined : DENIED)))
    step('cuts a long tool result', () => ctx.on('tools/post-execute', postExecute))
  } catch (e) {
    log('the Light agent chat keeps its tools', e)
  }
}
