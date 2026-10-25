// Seeds the Claude provider into the phone profile's user patch layer when the app has a model key (it comes from the device's Keychain / Keystore, handed to the engine as ANTHROPIC_API_KEY)
// and the layer is still empty. The key itself is never written: the provider names the environment variable (`apiKeyEnv`). A layer that already has entries is the user's own (the web
// Models page writes there) and is left alone.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

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
