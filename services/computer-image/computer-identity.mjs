// Who a cloud computer is, when its environment does not say. A computer made for one person is told at creation (KYBERNOS_API, KYBERNOS_COMPUTER_ID, KYBERNOS_COMPUTER_TOKEN,
// KYBERNOS_COMPUTER_MODEL in the machine's environment). A POOLED computer is made before anybody needs it and is handed to a person later, and the environment of a machine cannot
// change while it runs: its identity is written to the volume at the claim (`<DSH home>/kybernos/computer-identity.json`, 0600) and read from there. The environment wins when it
// has an identity (a machine made the old way has no file), so nothing that already runs changes.
//
// Pure and dependency-free. The plugin (a bundle) and the image's claim step (services/computer-image) both read the file; bundles do not import each other and the cloud image
// ships files one by one, so services/computer-image keeps a byte-for-byte copy of this file; packages/kybernos-cloud/test-computer-identity.mjs is the only thing that lets the two part.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const identityFile = (dshHome) => join(String(dshHome), 'kybernos', 'computer-identity.json')

// The address is the platform's own origin: https (http only for a loopback address, which cannot leave the machine), no path, no credentials.
const API_HTTPS = /^https:\/\/[A-Za-z0-9.-]{1,253}(:[0-9]{1,5})?$/u
const API_LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?$/u
const ID = /^[A-Za-z0-9._:-]{1,64}$/u
const TOKEN = /^[A-Za-z0-9._~+/=-]{16,512}$/u
const MODEL = /^[A-Za-z0-9._/-]{1,100}$/u

/** The identity as the machine will hold it, or null when anything of it is not what a platform would give. Only these four fields, only these characters: nothing else is kept. */
export function cleanIdentity (value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const api = String(value.api ?? '').replace(/\/+$/u, '')
  const id = String(value.computer_id ?? '')
  const token = String(value.token ?? '')
  const model = String(value.model ?? '') || 'auto'
  if (!(API_HTTPS.test(api) || API_LOOPBACK.test(api))) return null
  if (!ID.test(id) || !TOKEN.test(token) || !MODEL.test(model)) return null
  return { api, computer_id: id, token, model }
}

/** The identity on the volume, or null (none, unreadable or not valid). */
export function readIdentity (dshHome) {
  try { return cleanIdentity(JSON.parse(readFileSync(identityFile(dshHome), 'utf8'))) } catch (e) { return null }
}

/** Writes it for good: temporary file then rename, so a machine that stops in the middle never holds half an identity. Returns false for an identity that is not valid. */
export function writeIdentity (dshHome, value, now = new Date()) {
  const clean = cleanIdentity(value)
  if (clean === null) return false
  const file = identityFile(dshHome)
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file + '.tmp', JSON.stringify({ version: 1, ...clean, claimed_at: now.toISOString() }), { mode: 0o600 })
  chmodSync(file + '.tmp', 0o600)
  renameSync(file + '.tmp', file)
  return true
}

/** What this machine is: the environment when it has an identity, else the volume's. `source` is 'env', 'volume' or null (not a computer, or not claimed yet). */
export function identityOf (env, dshHome) {
  const id = String((env && env.KYBERNOS_COMPUTER_ID) || '')
  const token = String((env && env.KYBERNOS_COMPUTER_TOKEN) || '')
  if (id !== '' && token !== '') {
    return { source: 'env', id, token, api: String((env && env.KYBERNOS_API) || '').replace(/\/+$/u, ''), model: String((env && env.KYBERNOS_COMPUTER_MODEL) || '') || 'auto' }
  }
  const file = typeof dshHome === 'string' && dshHome !== '' ? readIdentity(dshHome) : null
  if (file !== null) return { source: 'volume', id: file.computer_id, token: file.token, api: file.api, model: file.model }
  return { source: null, id: '', token: '', api: String((env && env.KYBERNOS_API) || '').replace(/\/+$/u, ''), model: 'auto' }
}

const VARIABLES = { KYBERNOS_API: 'api', KYBERNOS_COMPUTER_ID: 'id', KYBERNOS_COMPUTER_TOKEN: 'token', KYBERNOS_COMPUTER_MODEL: 'model' }

/**
 * The `export` lines that give a process the identity its environment lacks, for a shell script to evaluate: nothing when the machine was made the old way. Every value passed
 * `cleanIdentity`, so none holds a quote or a space; they are single-quoted all the same.
 */
export function shellExports (env, dshHome) {
  const who = identityOf(env, dshHome)
  if (who.source !== 'volume') return ''
  const lines = []
  for (const [name, key] of Object.entries(VARIABLES)) {
    if (String((env && env[name]) || '') === '') lines.push(`export ${name}='${who[key]}'`)
  }
  return lines.join('\n')
}
