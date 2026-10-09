// kybernos-call: what a call remembers, on disk, under $DSH_HOME.
//
//   kybernos/livekit.env                          the secrets (chmod 600): LiveKit, Groq, the face provider, the clone provider
//   kybernos/kybernos-call/settings.json          the user's call settings
//   kybernos/kybernos-call/clones.json            recordings that were cloned at a provider (ids only, never a key)
//
// A secret goes IN through `writeKeys` and never comes back out: `keysStatus` says "set" or "missing". No DSH here.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHomeSync } from './dsh-home.mjs'
import { availableIds, checkProviderConfig } from './providers.mjs'

export const ENV_REL = 'kybernos/livekit.env'
const SETTINGS_REL = 'kybernos/kybernos-call/settings.json'
const CLONES_REL = 'kybernos/kybernos-call/clones.json'

const str = (v) => (typeof v === 'string' ? v : null)
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/
const ENGINE_RE = /^[a-z0-9_-]{1,32}$/
const VOICE_RE = /^[\p{L}\p{M}\p{N}._:() -]{1,100}$/u // letters of any language: the app's own French voice is "Amélie"

export const DEFAULT_SETTINGS = Object.freeze({
  language: 'auto',      // 'auto' follows what the user speaks, or a language code
  mode: 'voice',         // what a call without a member starts as: 'voice' or 'video'
  silenceMinutes: 5,     // hang up after this many minutes without the user speaking
  maxMinutes: 60,        // and never stay longer than this
  defaultVoice: null,    // { engine, voice, lang } on the app's voice engine, for a call without a member; null = the app's default
  cloneUpload: false,    // allow sending a recording to the clone provider (it leaves the machine): off until the user says so
  use: Object.freeze({ listen: 'groq', face: 'liveavatar' }), // which provider fills a slot (what speaks is `defaultVoice`; think and line have one choice)
  providers: Object.freeze({}) // each provider's own settings (a model, …), see providers.mjs
})

/** The secrets a call knows, each with what it must look like. A value that does not match is refused, never stored. */
export const KEY_SPECS = Object.freeze({
  LIVEKIT_URL: { re: /^(wss?|https?):\/\/[^\s/]+[^\s]*$/, what: 'a ws://, wss://, http:// or https:// address' },
  LIVEKIT_API_KEY: { re: /^[A-Za-z0-9._-]{3,128}$/, what: 'letters, digits, dots, dashes (3 to 128)' },
  LIVEKIT_API_SECRET: { re: /^\S{20,200}$/, what: 'at least 20 characters, no spaces' },
  GROQ_API_KEY: { re: /^\S{8,300}$/, what: 'no spaces' },
  LIVEAVATAR_API_KEY: { re: /^\S{8,300}$/, what: 'no spaces' },
  LIVEAVATAR_AVATAR_ID: { re: /^[A-Za-z0-9._-]{1,128}$/, what: 'letters, digits, dots, dashes' },
  LIVEAVATAR_SANDBOX: { re: /^[01]$/, what: '0 or 1' },
  ELEVENLABS_API_KEY: { re: /^\S{8,300}$/, what: 'no spaces' }
})

const voiceOf = (v) => {
  if (v === null || typeof v !== 'object') return null
  const engine = str(v.engine)
  const voice = str(v.voice)
  if (engine === null || !ENGINE_RE.test(engine) || voice === null || !VOICE_RE.test(voice)) return null
  const lang = str(v.lang)
  return { engine, voice, lang: (lang !== null && /^[A-Za-z]{2}/.test(lang)) ? lang.slice(0, 2).toLowerCase() : '' }
}

export function createStore (deps = {}) {
  const env = deps.env ?? process.env
  const dshHome = deps.dshHome ?? (async () => dshHomeSync(env))
  const now = deps.now ?? (() => new Date().toISOString())

  const pathOf = async (rel) => {
    const home = await dshHome()
    if (typeof home !== 'string' || home.length === 0) throw new Error('DSH home not found')
    return join(home, rel)
  }
  const readJson = async (rel, fallback) => {
    try { return JSON.parse(readFileSync(await pathOf(rel), 'utf8')) } catch (e) { return fallback }
  }
  const writeAtomic = async (rel, text, mode) => {
    const file = await pathOf(rel)
    mkdirSync(dirname(file), { recursive: true })
    const tmp = file + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
    writeFileSync(tmp, text, { mode })
    try { chmodSync(tmp, mode) } catch (e) { /* a filesystem without modes */ }
    renameSync(tmp, file)
  }

  // ── settings ─────────────────────────────────────────────────────────────
  /** Checks a patch of settings against the rules; returns what is kept and what was refused (with why). */
  const checkSettings = (patch) => {
    const kept = {}
    const refused = {}
    const p = (patch !== null && typeof patch === 'object' && !Array.isArray(patch)) ? patch : {}
    for (const [k, v] of Object.entries(p)) {
      if (k === 'language') { if (v === 'auto' || (str(v) !== null && LANG_RE.test(v))) kept.language = v; else refused.language = 'a language code like "fr", or "auto"' }
      else if (k === 'mode') { if (v === 'voice' || v === 'video') kept.mode = v; else refused.mode = '"voice" or "video"' }
      else if (k === 'silenceMinutes') { if (Number.isInteger(v) && v >= 1 && v <= 60) kept.silenceMinutes = v; else refused.silenceMinutes = 'a whole number of minutes, 1 to 60' }
      else if (k === 'maxMinutes') { if (Number.isInteger(v) && v >= 5 && v <= 240) kept.maxMinutes = v; else refused.maxMinutes = 'a whole number of minutes, 5 to 240' }
      else if (k === 'defaultVoice') {
        if (v === null) kept.defaultVoice = null
        else { const ok = voiceOf(v); if (ok !== null) kept.defaultVoice = ok; else refused.defaultVoice = 'an engine voice ({ engine, voice, lang }) or null' }
      } else if (k === 'cloneUpload') { if (typeof v === 'boolean') kept.cloneUpload = v; else refused.cloneUpload = 'true or false' }
      else if (k === 'use') {
        if (v === null || typeof v !== 'object' || Array.isArray(v)) { refused.use = 'an object like { listen, face }'; continue }
        const use = {}
        for (const [slot, id] of Object.entries(v)) {
          if (slot !== 'listen' && slot !== 'face') { refused['use.' + slot] = 'a slot with a choice (listen, face)'; continue }
          if (typeof id === 'string' && availableIds(slot).includes(id)) use[slot] = id
          else refused['use.' + slot] = 'one of: ' + availableIds(slot).join(', ')
        }
        kept.use = use
      } else if (k === 'providers') {
        const out = checkProviderConfig(v)
        Object.assign(refused, out.refused)
        kept.providers = out.kept
      }
      else refused[k] = 'not a call setting'
    }
    return { kept, refused }
  }
  /** The defaults under what was kept; `use` and `providers` are merged one level down, not replaced. */
  const compose = (base, kept) => {
    const next = Object.assign({}, base, kept)
    next.use = Object.assign({}, base.use, kept.use ?? {})
    const providers = {}
    for (const [id, values] of Object.entries(base.providers ?? {})) providers[id] = Object.assign({}, values)
    for (const [id, values] of Object.entries(kept.providers ?? {})) providers[id] = Object.assign({}, providers[id] ?? {}, values)
    next.providers = providers
    return next
  }
  const readSettings = async () => {
    const saved = await readJson(SETTINGS_REL, {})
    // What is on disk is read through the same rules: a hand-edited file cannot slip a bad value in.
    return compose(DEFAULT_SETTINGS, checkSettings(saved).kept)
  }
  const writeSettings = async (patch) => {
    const { kept, refused } = checkSettings(patch)
    if (Object.keys(refused).length > 0) return { ok: false, error: 'invalid settings', refused: refused }
    const next = compose(await readSettings(), kept)
    await writeAtomic(SETTINGS_REL, JSON.stringify(next, null, 2) + '\n', 0o600)
    return { ok: true, settings: next }
  }

  // ── secrets ──────────────────────────────────────────────────────────────
  const readEnvLines = async () => {
    try { return readFileSync(await pathOf(ENV_REL), 'utf8').split(/\r?\n/) } catch (e) { return [] }
  }
  const parseValue = (raw) => raw.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
  const readKeys = async () => {
    const out = {}
    for (const line of await readEnvLines()) {
      const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line)
      if (m !== null && Object.prototype.hasOwnProperty.call(KEY_SPECS, m[1])) out[m[1]] = parseValue(m[2])
    }
    return out
  }
  /** What is set, never what it is. The LiveKit address is not a secret: its host is shown so the user can recognise it. */
  const keysStatus = async () => {
    const keys = await readKeys()
    const status = {}
    for (const name of Object.keys(KEY_SPECS)) status[name] = { set: typeof keys[name] === 'string' && keys[name] !== '' }
    if (status.LIVEKIT_URL.set) { try { status.LIVEKIT_URL.host = new URL(keys.LIVEKIT_URL.replace(/^ws/, 'http')).host } catch (e) { /* not a URL */ } }
    if (status.LIVEAVATAR_SANDBOX.set) status.LIVEAVATAR_SANDBOX.value = keys.LIVEAVATAR_SANDBOX
    if (status.LIVEAVATAR_AVATAR_ID.set) status.LIVEAVATAR_AVATAR_ID.value = keys.LIVEAVATAR_AVATAR_ID
    if (status.LIVEKIT_URL.set) status.LIVEKIT_URL.value = keys.LIVEKIT_URL // an address, not a secret: shown so the user can check it
    return status
  }
  /**
   * Sets, replaces or (with '' or null) removes secrets. Every other line of the file (the worker's own KYBER_*
   * options, comments) is left exactly as it was. All-or-nothing: one bad value and nothing is written.
   */
  const writeKeys = async (patch) => {
    const p = (patch !== null && typeof patch === 'object' && !Array.isArray(patch)) ? patch : {}
    const refused = {}
    const changes = {}
    for (const [name, value] of Object.entries(p)) {
      if (!Object.prototype.hasOwnProperty.call(KEY_SPECS, name)) { refused[name] = 'not a call secret'; continue }
      if (value === null || value === '') { changes[name] = null; continue }
      if (typeof value !== 'string' || !KEY_SPECS[name].re.test(value.trim())) { refused[name] = 'expected ' + KEY_SPECS[name].what; continue }
      changes[name] = value.trim()
    }
    if (Object.keys(refused).length > 0) return { ok: false, error: 'invalid secrets', refused: refused }
    const lines = await readEnvLines()
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    const seen = new Set()
    const out = []
    for (const line of lines) {
      const m = /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line)
      if (m !== null && Object.prototype.hasOwnProperty.call(changes, m[1])) {
        seen.add(m[1])
        if (changes[m[1]] !== null) out.push(m[1] + '=' + changes[m[1]])
      } else out.push(line)
    }
    for (const [name, value] of Object.entries(changes)) if (value !== null && !seen.has(name)) out.push(name + '=' + value)
    await writeAtomic(ENV_REL, out.join('\n') + '\n', 0o600)
    return { ok: true, status: await keysStatus() }
  }

  // ── clones ───────────────────────────────────────────────────────────────
  const readClones = async () => {
    const saved = await readJson(CLONES_REL, {})
    const out = {}
    for (const [id, e] of Object.entries((saved !== null && typeof saved === 'object') ? saved : {})) {
      if (/^[A-Za-z0-9._-]{1,64}$/.test(id) && e !== null && typeof e === 'object' && e.provider === 'elevenlabs' && str(e.remoteId) !== null && /^[A-Za-z0-9]{6,64}$/.test(e.remoteId)) {
        out[id] = { provider: 'elevenlabs', remoteId: e.remoteId, name: str(e.name) ?? '', createdAt: str(e.createdAt) ?? '' }
      }
    }
    return out
  }
  const writeClones = async (clones) => writeAtomic(CLONES_REL, JSON.stringify(clones, null, 2) + '\n', 0o600)
  const setClone = async (localId, entry) => {
    const clones = await readClones()
    clones[localId] = { provider: 'elevenlabs', remoteId: entry.remoteId, name: entry.name ?? '', createdAt: now() }
    await writeClones(clones)
    return clones[localId]
  }
  const deleteClone = async (localId) => {
    const clones = await readClones()
    const had = clones[localId]
    delete clones[localId]
    await writeClones(clones)
    return had ?? null
  }

  return { checkSettings, readSettings, writeSettings, readKeys, keysStatus, writeKeys, readClones, setClone, deleteClone, envPath: () => pathOf(ENV_REL), exists: async () => existsSync(await pathOf(ENV_REL)) }
}
