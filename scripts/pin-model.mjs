#!/usr/bin/env node
// Pins the default model of a SANDBOX profile, so that a sandbox DSH always has a model it can talk to.
//
//   node scripts/pin-model.mjs <sandbox home>/.dsh/profiles/web/cordis.patch.yml <provider> <model>
//   node scripts/pin-model.mjs --home <sandbox home> [<provider> <model>]       (defaults: kybernos glm)
//
// Why: `scripts/sandbox/setup.sh` clones the owner's profile and copies no key. The owner's default model (the `agent-default-model` block of cordis.patch.yml) is a provider the
// sandbox holds no key for, so every agent turn of a journey died with « no credential for provider route … » and nothing reached the replica: the whole 2026-10-24 run of the
// two-account journeys (A3) was void for that reason. The route `kybernos` is the one the connected account adds; the local replica serves the model `glm` on it.
//
// It edits ONE file and refuses any file that is not inside a `.kybernos-sandbox` folder (by its real path, so a link into ~/.dsh does not get through). Nothing else is read or written.
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_PROVIDER = 'kybernos'
export const DEFAULT_MODEL = 'glm'

const BLOCK = /(- id: agent-default-model\n  name: "@deepseek-ai\/dsh-agent-default-model"\n  config:\n    provider: )([^\n]+)(\n    model: )([^\n]+)/
const SAFE_WORD = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

/** True when `file` really lives inside a `.kybernos-sandbox` folder (symlinks resolved, `..` collapsed). */
export const isSandboxFile = (file) => {
  if (typeof file !== 'string' || file === '') return false
  const inside = (p) => p.includes(sep + '.kybernos-sandbox' + sep)
  const abs = resolve(file)
  if (!inside(abs)) return false
  if (!existsSync(abs)) return false
  try { return inside(realpathSync(abs)) } catch { return false }
}

/** Replaces the provider and model of the `agent-default-model` block in a profile's text. Pure. Returns `{ text, before, after, changed }`; throws when the block is not there. */
export const pinText = (text, provider, model) => {
  if (!SAFE_WORD.test(provider) || !SAFE_WORD.test(model)) throw new Error('refused: the provider and the model must be plain ids (' + JSON.stringify([provider, model]) + ')')
  const m = BLOCK.exec(text)
  if (!m) throw new Error('no agent-default-model block in this file (the engine changed its shape?)')
  const before = { provider: m[2].trim(), model: m[4].trim() }
  const out = text.replace(BLOCK, (all, a, _p, b) => a + provider + b + model)
  return { text: out, before, after: { provider, model }, changed: before.provider !== provider || before.model !== model }
}

/** Pins `file` (a sandbox profile's cordis.patch.yml). Writes through a temporary file and a rename, then reads the block back. Returns what it found and set. */
export const pinModel = (file, provider = DEFAULT_PROVIDER, model = DEFAULT_MODEL) => {
  if (!isSandboxFile(file)) throw new Error('refused: ' + JSON.stringify(file) + ' is not a file inside a .kybernos-sandbox folder (this tool only pins sandbox profiles, never the real ~/.dsh)')
  const abs = resolve(file)
  const r = pinText(readFileSync(abs, 'utf8'), provider, model)
  if (r.changed) {
    const tmp = abs + '.pin-tmp'
    writeFileSync(tmp, r.text)
    renameSync(tmp, abs)
  }
  const back = BLOCK.exec(readFileSync(abs, 'utf8'))
  if (!back || back[2].trim() !== provider || back[4].trim() !== model) throw new Error('the block does not read back as ' + provider + '/' + model + ' after the write')
  return { file: abs, before: r.before, after: r.after, changed: r.changed }
}

/** The profile file of a sandbox HOME. */
export const profileOf = (sandboxHome) => join(sandboxHome, '.dsh', 'profiles', 'web', 'cordis.patch.yml')

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const argv = process.argv.slice(2)
  try {
    let file
    let rest
    if (argv[0] === '--home') { file = profileOf(argv[1] || ''); rest = argv.slice(2) } else { file = argv[0]; rest = argv.slice(1) }
    if (!file) throw new Error('usage: pin-model.mjs <cordis.patch.yml> <provider> <model>   or   pin-model.mjs --home <sandbox home> [<provider> <model>]')
    const r = pinModel(file, rest[0] || DEFAULT_PROVIDER, rest[1] || DEFAULT_MODEL)
    console.log('pinned ' + r.before.provider + '/' + r.before.model + ' -> ' + r.after.provider + '/' + r.after.model + (r.changed ? '' : ' (already)') + '  in ' + dirname(dirname(dirname(dirname(r.file)))).split(sep).slice(-2).join('/'))
  } catch (e) {
    console.error(String(e && e.message || e))
    process.exit(2)
  }
}
