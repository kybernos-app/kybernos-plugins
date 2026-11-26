// The state of the front-desk plugin: where it lives and what it holds. Everything is under <DSH home>/kybernos/front-desk/:
//   config.json    what is not secret: the public address of the service, the model's address and name, the telegram switch
//   secrets.json   0600: the owner token the plugin and the service share, the model's key, the Telegram bot token
//   data/          the service's own data folder (versions, conversations, the ledger, the KILL file)
//   fiche.json     the starter fiche (the service reads it ONCE, to write version 1; after that the versions live in data/)
// Pure node:fs, no DSH service: unit-testable on a temp folder. Secrets never leave this file except as the child's environment.

import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,39}$/

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The DSH folder the way DSH resolves it: a non-blank $DSH_HOME (a leading `~` expanded), else ~/.dsh. */
export function dshHome (env = process.env) {
  const raw = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (raw === '') return join(homedir(), '.dsh')
  if (raw === '~') return homedir()
  return resolve(raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw)
}

export const stateDir = (home) => join(home, 'kybernos', 'front-desk')

const writeAtomic = (file, text, mode) => {
  mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 })
  const tmp = file + '.tmp'
  try {
    writeFileSync(tmp, text, { mode })
    chmodSync(tmp, mode)
    renameSync(tmp, file)
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch (e2) { /* nothing to clean */ }
    throw e
  }
}

const readJson = (file) => {
  try { const v = JSON.parse(readFileSync(file, 'utf8')); return plain(v) ? v : {} } catch (e) { return {} }
}

/** An address the model is reached at, or null. Only http(s); no credentials in the address; no query or fragment. */
export function cleanBaseUrl (v) {
  if (typeof v !== 'string') return null
  try {
    const u = new URL(v.trim())
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username !== '' || u.password !== '' || u.search !== '' || u.hash !== '') return null
    return u.origin + u.pathname.replace(/\/+$/, '')
  } catch (e) { return null }
}

/** The public address of the service (where visitors reach it), an origin, or null. */
export function cleanPublicUrl (v) {
  if (typeof v !== 'string') return null
  try {
    const u = new URL(v.trim())
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username !== '' || u.password !== '') return null
    return u.origin
  } catch (e) { return null }
}

const TELEGRAM_RE = /^\d{5,}:[\w-]{20,}$/
const cleanModelName = (v) => (typeof v === 'string' && /^[\w./:@+-]{1,120}$/.test(v.trim()) ? v.trim() : null)
const cleanKey = (v) => (typeof v === 'string' && v.trim().length >= 8 && v.trim().length <= 400 && !/\s/.test(v.trim()) ? v.trim() : null)

/** The starter fiche written the first time: a name, no fact, every action off, small caps. The owner fills it in through the Atelier or Kaby. */
export function starterFiche (name = 'My shop') {
  const slug = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return {
    slug: SLUG_RE.test(slug) ? slug : 'my-shop',
    name: String(name).slice(0, 80),
    language: 'en',
    brand: { color: '#2F6B54', greeting: '' },
    identity: '',
    tone: '',
    knowledge: [],
    unknown: 'Say you do not know, and offer to leave a message for the shop.',
    instructions: [],
    guardrails: { actions: { leave_message: 'approve', note_visitor: 'off', forget_visitor: 'auto' }, budget: { dailyCap: 1, visitorDailyCap: 0.1 }, allowedOrigins: [], retentionMonths: 12 },
  }
}

export function createConfigStore ({ home = dshHome(), randomToken = () => randomBytes(32).toString('base64url') } = {}) {
  const dir = stateDir(home)
  const configFile = join(dir, 'config.json')
  const secretsFile = join(dir, 'secrets.json')
  const ficheFile = join(dir, 'fiche.json')
  const dataDir = join(dir, 'data')

  const readSecrets = () => readJson(secretsFile)
  const writeSecrets = (s) => writeAtomic(secretsFile, JSON.stringify(s, null, 2) + '\n', 0o600)

  return {
    dir, dataDir, ficheFile,
    pidFile: join(dir, 'service.pid'),
    logFile: join(dir, 'service.log'),

    /** What is not secret, with a default for everything. */
    read () {
      const c = readJson(configFile)
      const m = plain(c.model) ? c.model : {}
      return {
        publicUrl: cleanPublicUrl(c.publicUrl),
        model: { baseUrl: cleanBaseUrl(m.baseUrl), name: cleanModelName(m.name) },
        telegram: c.telegram === true,
        // Set by Start and cleared by Stop: a service that was running comes back by itself when DSH starts.
        autostart: c.autostart === true,
      }
    },

    /** Which secrets are set. The values never come out of here. */
    secretsSet () {
      const s = readSecrets()
      return { modelKey: cleanKey(s.modelApiKey) !== null, telegram: typeof s.telegramToken === 'string' && TELEGRAM_RE.test(s.telegramToken) }
    },

    /** The owner token the plugin and the service share: made on the first call, kept 0600. */
    ownerToken () {
      const s = readSecrets()
      if (typeof s.ownerToken === 'string' && s.ownerToken.length >= 32) return s.ownerToken
      const fresh = randomToken()
      writeSecrets({ ...s, ownerToken: fresh })
      return fresh
    },

    /**
     * `patch` may carry publicUrl, model { baseUrl, name, apiKey }, telegram { token } or { off: true }. An invalid value refuses the whole patch
     * (`{ ok:false, error }`), so nothing is half written. `null`/'' clears a value. Never echoes a secret.
     */
    write (patch) {
      if (!plain(patch)) return { ok: false, error: 'nothing_to_write' }
      const config = this.read()
      const secrets = readSecrets()
      let touched = false
      if ('publicUrl' in patch) {
        if (patch.publicUrl === null || patch.publicUrl === '') config.publicUrl = null
        else { const u = cleanPublicUrl(patch.publicUrl); if (u === null) return { ok: false, error: 'bad_public_url' }; config.publicUrl = u }
        touched = true
      }
      if (plain(patch.model)) {
        const m = patch.model
        if ('baseUrl' in m) { const u = cleanBaseUrl(m.baseUrl); if (u === null) return { ok: false, error: 'bad_model_url' }; config.model.baseUrl = u; touched = true }
        if ('name' in m) { const n = cleanModelName(m.name); if (n === null) return { ok: false, error: 'bad_model_name' }; config.model.name = n; touched = true }
        if ('apiKey' in m) { const k = cleanKey(m.apiKey); if (k === null) return { ok: false, error: 'bad_model_key' }; secrets.modelApiKey = k; touched = true }
      }
      if (plain(patch.telegram)) {
        if (patch.telegram.off === true) { delete secrets.telegramToken; config.telegram = false; touched = true }
        else if ('token' in patch.telegram) {
          if (typeof patch.telegram.token !== 'string' || !TELEGRAM_RE.test(patch.telegram.token.trim())) return { ok: false, error: 'bad_telegram_token' }
          secrets.telegramToken = patch.telegram.token.trim(); config.telegram = true; touched = true
        }
      }
      if (typeof patch.autostart === 'boolean') { config.autostart = patch.autostart; touched = true }
      if (!touched) return { ok: false, error: 'nothing_to_write' }
      writeAtomic(configFile, JSON.stringify(config, null, 2) + '\n', 0o600)
      writeSecrets(secrets)
      return { ok: true }
    },

    /** Whether the service can be started: a model, its key, and a fiche (written from the starter when there is none and no version exists yet). */
    ready () {
      const c = this.read()
      const s = readSecrets()
      const missing = []
      if (c.model.baseUrl === null) missing.push('model_url')
      if (c.model.name === null) missing.push('model_name')
      if (cleanKey(s.modelApiKey) === null) missing.push('model_key')
      return { ok: missing.length === 0, missing }
    },

    /** Writes the starter fiche once (never over an existing one) and makes the data folder. Returns the fiche file. */
    ensureFiche (name) {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 })
      if (!existsSync(ficheFile)) writeAtomic(ficheFile, JSON.stringify(starterFiche(name), null, 2) + '\n', 0o600)
      return ficheFile
    },

    /** The environment of the child: nothing is inherited but what the service needs, so no key of the owner's DSH reaches it. */
    childEnv ({ port, env = process.env }) {
      const c = this.read()
      const s = readSecrets()
      const out = {
        PATH: typeof env.PATH === 'string' ? env.PATH : '/usr/bin:/bin',
        HOME: typeof env.HOME === 'string' ? env.HOME : homedir(),
        FRONT_DESK_FICHE: ficheFile,
        FRONT_DESK_DIR: dataDir,
        FRONT_DESK_PORT: String(port),
        FRONT_DESK_HOST: '127.0.0.1',
        FRONT_DESK_OWNER_TOKEN: this.ownerToken(),
        MODEL_BASE_URL: c.model.baseUrl || '',
        MODEL_NAME: c.model.name || '',
        MODEL_API_KEY: cleanKey(s.modelApiKey) || '',
      }
      if (c.publicUrl !== null) out.FRONT_DESK_PUBLIC_URL = c.publicUrl
      if (c.telegram && typeof s.telegramToken === 'string' && TELEGRAM_RE.test(s.telegramToken)) out.TELEGRAM_BOT_TOKEN = s.telegramToken
      return out
    },
  }
}
