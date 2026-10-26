// First-run seeds of the phone app, run by bootstrap.mjs before the engine starts: the Claude provider of a test build, and the first workspace.
//
// Seeds the Claude provider into the phone profile's user patch layer when the engine has a model key in its environment (a device-cloud test build with `--model` hands it over as ANTHROPIC_API_KEY;
// a person's own key goes through the first-run wizard instead) and the layer is still empty. The key itself is never written: the provider names the environment variable (`apiKeyEnv`). A layer that already has entries is the user's own (the web
// Models page writes there) and is left alone.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'

export const MARKER = '# kybernos-managed: the Claude provider below was seeded because the app holds an Anthropic key in the device secure storage'

const BLOCK = `${MARKER}
- id: agent-default-model
  config:
    provider: claude
    model: claude-haiku-5-5
- id: llm-pi-ai
  config:
    providers:
      claude:
        displayName: Claude
        api: anthropic-messages
        baseURL: https://api.anthropic.com
        apiKeyEnv: ANTHROPIC_API_KEY
        models:
          - id: claude-haiku-5-5
            name: Claude Haiku 5.5
            contextWindow: 200000
            maxTokens: 8192
            input:
              - text
          - id: claude-sonnet-5-5
            name: Claude Sonnet 5.5
            contextWindow: 200000
            maxTokens: 8192
            input:
              - text
          - id: claude-opus-5-5
            name: Claude Opus 5.5
            contextWindow: 200000
            maxTokens: 8192
            input:
              - text
`

/** True when the file holds no entries: nothing, or only comments and an empty list. */
export const isEmptyPatch = (text) => {
  const body = String(text).split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#')).join('')
  return body === '' || body === '[]'
}

/** Returns 'seeded', 'kept' (the layer has entries) or 'no-key'. */
export const seedClaudeProvider = ({ patchFile, env }) => {
  const key = env.ANTHROPIC_API_KEY
  if (typeof key !== 'string' || key === '') return 'no-key'
  const current = existsSync(patchFile) ? readFileSync(patchFile, 'utf8') : ''
  if (!isEmptyPatch(current)) return 'kept'
  writeFileSync(patchFile, BLOCK)
  return 'seeded'
}

/**
 * The first workspace of a fresh install, so that the first screen of the interface is a chat that can be written to and not a « Choose a workspace » form (a person who has never
 * heard the word cannot send a first message otherwise). The store is DSH's `storages/workspace.json`, written here in the layout DSH 0.2 keeps (unit workspace, version 2: the
 * same document scripts/sandbox/rewrite.mjs and packages/kybernos-gate/docker/seed-workspace.mjs write); the folder is the agent's own working folder of the app.
 * Only a file that does not exist yet is written: a store DSH already made, with or without workspaces, is the person's.
 * Returns 'seeded' or 'kept'.
 */
export const seedFirstWorkspace = ({ file, folder, id = randomUUID(), now = new Date() }) => {
  if (typeof folder !== 'string' || folder === '' || existsSync(file)) return 'kept'
  const at = now.toISOString()
  mkdirSync(dirname(file), { recursive: true })
  const doc = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [id], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: { workspaces: { [id]: { path: folder, title: basename(folder), sessionIds: [], createdAt: at, updatedAt: at } } },
  }
  writeFileSync(file, JSON.stringify(doc))
  return 'seeded'
}
