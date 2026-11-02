// Which service connects the person's apps for their agents: Composio with their own key, or Kybernos Cloud. The choice of
// Settings › Connectors, kept in `<DSH home>/kybernos/connectors.json` (a few bytes, no secret). kybernos-cloud reads the same file
// (a tiny copy of readProvider: bundles cannot import each other) to stop offering its connection tools when Composio is chosen.
// Nothing chosen (no file) = as before: both are available.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const PROVIDERS = ['composio', 'kybernos']

export const providerPath = (home) => join(home, 'kybernos', 'connectors.json')

const readObject = (file) => {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch (e) { return {} }
}

/** 'composio' | 'kybernos' | null (nothing chosen, or an unreadable file). */
export const readProvider = (home) => {
  const v = readObject(providerPath(home)).provider
  return PROVIDERS.includes(v) ? v : null
}

/** Writes the choice (atomically, 0600), keeping whatever else the file holds. `null` clears it. Throws on a value that is not a provider. */
export const writeProvider = (home, provider) => {
  if (provider !== null && !PROVIDERS.includes(provider)) throw new Error('invalid provider')
  const file = providerPath(home)
  const next = Object.assign({}, readObject(file))
  if (provider === null) delete next.provider
  else next.provider = provider
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
  try { chmodSync(tmp, 0o600) } catch (e) { /* best effort on this filesystem */ }
  renameSync(tmp, file)
}
