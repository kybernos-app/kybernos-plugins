// Gate configuration, read from the environment. It refuses to start without a password: there is no default.
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { hashPassword, parseVerifier } from './password.mjs'

export class ConfigError extends Error {}

const flag = (value) => /^(1|true|yes|on)$/iu.test(String(value ?? ''))
const integer = (name, value, fallback, min, max) => {
  if (value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${name} must be an integer between ${min} and ${max}`)
  return n
}

/** A 32-byte-or-more secret for the session cookie: env, else a file next to DSH's data, else memory only. */
function sessionSecret (env, dshHome, warn) {
  if (typeof env.KYBERNOS_GATE_SECRET === 'string' && env.KYBERNOS_GATE_SECRET !== '') {
    if (env.KYBERNOS_GATE_SECRET.length < 32) throw new ConfigError('KYBERNOS_GATE_SECRET must be at least 32 characters')
    return Buffer.from(env.KYBERNOS_GATE_SECRET, 'utf8')
  }
  const file = join(dshHome, 'kybernos', 'gate-secret')
  try {
    if (existsSync(file)) {
      const stored = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64url')
      if (stored.length >= 32) return stored
    }
    const fresh = randomBytes(32)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, fresh.toString('base64url') + '\n', { mode: 0o600 })
    return fresh
  } catch (e) {
    warn('cannot persist the session secret (' + (e && e.code ? e.code : 'error') + '): sessions end when the gate restarts')
    return randomBytes(32)
  }
}

/**
 * @param {Record<string,string|undefined>} env
 * @param {{ warn?: (msg: string) => void, hashParams?: object }} [options] `hashParams` lets tests use a cheap scrypt.
 */
export async function loadConfig (env = process.env, { warn = () => {}, hashParams } = {}) {
  const dshHome = env.DSH_HOME || join(homedir(), '.dsh')

  let verifier = null
  if (typeof env.KYBERNOS_GATE_PASSWORD_HASH === 'string' && env.KYBERNOS_GATE_PASSWORD_HASH !== '') {
    verifier = env.KYBERNOS_GATE_PASSWORD_HASH
    if (parseVerifier(verifier) === null) throw new ConfigError('KYBERNOS_GATE_PASSWORD_HASH is not a valid scrypt verifier (make one with: kybernos-gate hash)')
    if (env.KYBERNOS_GATE_PASSWORD) warn('KYBERNOS_GATE_PASSWORD_HASH wins; KYBERNOS_GATE_PASSWORD is ignored')
  } else if (typeof env.KYBERNOS_GATE_PASSWORD === 'string' && env.KYBERNOS_GATE_PASSWORD !== '') {
    if (env.KYBERNOS_GATE_PASSWORD.length < 8) throw new ConfigError('KYBERNOS_GATE_PASSWORD must be at least 8 characters')
    verifier = await hashPassword(env.KYBERNOS_GATE_PASSWORD, hashParams)
  } else {
    throw new ConfigError('set KYBERNOS_GATE_PASSWORD (or KYBERNOS_GATE_PASSWORD_HASH): the gate has no default password')
  }

  let upstream
  try { upstream = new URL(env.KYBERNOS_GATE_UPSTREAM || 'http://127.0.0.1:3081') } catch (e) { throw new ConfigError('KYBERNOS_GATE_UPSTREAM is not a URL') }
  if (upstream.protocol !== 'http:') throw new ConfigError('KYBERNOS_GATE_UPSTREAM must be an http:// URL (DSH listens in clear text on loopback)')

  const user = env.KYBERNOS_GATE_USER === undefined || env.KYBERNOS_GATE_USER === '' ? 'kybernos' : env.KYBERNOS_GATE_USER
  if (user.length > 64) throw new ConfigError('KYBERNOS_GATE_USER is too long')

  return {
    host: env.KYBERNOS_GATE_HOST || '127.0.0.1',
    port: integer('KYBERNOS_GATE_PORT', env.KYBERNOS_GATE_PORT, 3080, 0, 65535),
    upstream,
    user,
    verifier,
    trustProxy: flag(env.KYBERNOS_GATE_TRUST_PROXY),
    sessionDays: integer('KYBERNOS_GATE_SESSION_DAYS', env.KYBERNOS_GATE_SESSION_DAYS, 30, 1, 365),
    dshHome,
    dshSignIn: env.KYBERNOS_GATE_DSH_SIGNIN === undefined ? true : flag(env.KYBERNOS_GATE_DSH_SIGNIN),
    secret: sessionSecret(env, dshHome, warn)
  }
}
