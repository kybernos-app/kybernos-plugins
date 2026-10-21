// ── the agent's own path to the entries store: a host tool, never the route ──
//
// `POST /kybernos/slash/entries` serves the page: it is called by Settings ▸ Commands, which carries the
// signed DSH session cookie. The `slash-msgaction-creator` skill, run by the agent, has no session — so it
// calls THIS tool, which applies the same mutation and the same validation in process. There is nothing on
// the wire, no token to leak and no exception to document: a route that accepted "a cookie, or no Origin at
// all" would be bypassed by simply omitting a header.
//
// A bundle imports nothing from another one, so the `dsh-tools` lookup below is a copy of the recipe the
// other tool-carrying bundles use (kybernos-motion, kybernos-modeleur, kybernos-bricks, kybernos-slides).
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const TOOL_NAME = 'enregistrer_entree'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const CANDIDATS_DSH_TOOLS = [
  join(DSH_HOME, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
  '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
]

async function chargerDefineTool () {
  for (const chemin of CANDIDATS_DSH_TOOLS) {
    if (!existsSync(chemin)) continue
    try {
      const m = await import(chemin)
      if (typeof m?.defineTool === 'function') return m.defineTool
    } catch (e) { /* the literal shape below is enough */ }
  }
  return undefined
}

/** The exact shape `defineTool` produces, for when dsh-tools cannot be imported. */
export function definitionLitterale (o) {
  return { name: o.name, description: o.description, parameters: { type: 'object', properties: o.parameters }, output: { schema: {}, render: (args, value) => o.render(args, value) }, execute: o.execute }
}
export function definitionSpec (o) {
  return { name: o.name, description: o.description, parameters: o.parameters, output: { schema: { type: 'json' }, render: (args, value) => o.render(args, value) }, execute: o.execute }
}

/**
 * The tool's definition. `store` is injected so this file imports nothing from the host half and a test can
 * drive it with a throw-away store: { path(), read(path), problem(state, file, saving), mutate(entries, body), write(list, path) }.
 */
export function specOutil (store) {
  return {
    name: TOOL_NAME,
    description: 'Create, update, delete or replace kybernos slash commands and message actions (Settings ▸ Commands). Same body as POST /kybernos/slash/entries: {entry}, {entries}, {delete: id | [ids]}, {replace: [...]}.',
    // The spec map dsh-tools wants (the literal fallback wraps it into a JSON Schema, like the other bundles).
    parameters: {
      body: { type: 'object', additionalProperties: true, description: 'the mutation: {entry} | {entries} | {delete} | {replace}' },
    },
    render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    execute: async (args) => {
      const body = args !== null && typeof args === 'object' ? args.body : null
      if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'body object expected' }
      let p = null
      try {
        p = store.path()
        const state = store.read(p)
        // Present but unusable or corrupt: nothing is written, exactly like the route (the file is left as it
        // is, plus a copy of it next to it) — the next write would otherwise lose every saved entry.
        const problem = store.problem(state, p, true)
        if (problem !== null) return { ok: false, path: p, state: state.corrupt === true ? 'corrupt' : 'unreadable', error: problem }
        const out = store.mutate(state.entries, body)
        if (out.ok === false) return { ok: false, error: out.error, path: p, total: state.entries.length }
        store.write(out.entries, p)
        const apres = store.read(p)
        return { ok: true, path: p, total: apres.entries.length, entries: apres.entries }
      } catch (e) {
        return { ok: false, error: 'write failed: ' + String(e && e.message ? e.message : e), path: p }
      }
    },
  }
}

/** Registers the tool; a tools service that refuses it must never stop the plugin from starting. */
export async function enregistrerOutil (tools, store) {
  if (tools === null || tools === undefined || typeof tools.register !== 'function') return false
  const options = specOutil(store)
  const defineTool = await chargerDefineTool()
  tools.register(defineTool !== undefined ? defineTool(definitionSpec(options)) : definitionLitterale(options))
  return true
}
