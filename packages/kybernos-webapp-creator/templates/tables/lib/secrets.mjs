// secrets.mjs — the two secrets of the app: `KB_AUTH_SECRET` (signs sessions and invitations) and `KB_BOOT_KEY` (mints the owner's link).
//
// A hosted deployment passes both in the environment and nothing is written. A local run (the apps runtime passes no environment) gets them generated once into
// `<data>/secrets.json`, mode 0600. A value from the environment that is not good is refused by name, never echoed. Pure: the file and the randomness are injected.
import { randomBytes } from 'node:crypto'
import { hexKey } from './token.mjs'

export const SECRETS_FILE = 'secrets.json'
export const AUTH_SECRET_MIN = 32

const goodAuth = (s) => typeof s === 'string' && s.length >= AUTH_SECRET_MIN && s.length <= 256

/**
 * `{ env, read, write, random }`: `read()` gives the stored `{ authSecret?, bootKey? }` (or null), `write(obj)` stores it whole.
 * Answers `{ authSecret, bootKey, from: { authSecret, bootKey } }`, each `from` being `env`, `file` or `generated`; `bootKey` is a Buffer.
 */
export function resolveSecrets ({ env = {}, read, write, random = randomBytes }) {
  const stored = (() => { try { const v = read(); return v !== null && typeof v === 'object' ? v : {} } catch (e) { return {} } })()
  const out = { from: {} }
  let dirty = false

  if (env.KB_AUTH_SECRET !== undefined && env.KB_AUTH_SECRET !== '') {
    if (!goodAuth(env.KB_AUTH_SECRET)) throw new Error('KB_AUTH_SECRET must be ' + AUTH_SECRET_MIN + ' to 256 characters')
    out.authSecret = env.KB_AUTH_SECRET
    out.from.authSecret = 'env'
  } else if (goodAuth(stored.authSecret)) {
    out.authSecret = stored.authSecret
    out.from.authSecret = 'file'
  } else {
    out.authSecret = random(32).toString('base64url')
    out.from.authSecret = 'generated'
    dirty = true
  }

  if (env.KB_BOOT_KEY !== undefined && env.KB_BOOT_KEY !== '') {
    const key = hexKey(env.KB_BOOT_KEY)
    if (key === null) throw new Error('KB_BOOT_KEY must be 32 to 256 hexadecimal characters (16 bytes or more)')
    out.bootKey = key
    out.from.bootKey = 'env'
  } else if (hexKey(stored.bootKey) !== null) {
    out.bootKey = hexKey(stored.bootKey)
    out.from.bootKey = 'file'
  } else {
    out.bootKey = random(32)
    out.from.bootKey = 'generated'
    dirty = true
  }

  // only what was generated is written: a secret that came from the environment never lands on disk
  if (dirty) {
    write({
      authSecret: out.from.authSecret === 'env' ? stored.authSecret : out.authSecret,
      bootKey: out.from.bootKey === 'env' ? stored.bootKey : out.bootKey.toString('hex'),
    })
  }
  return out
}
