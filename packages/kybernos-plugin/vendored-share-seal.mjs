// kybernos-db/share: sealing a shared snapshot with a password. The one rule: the server that hosts a snapshot never holds anything it can read, so the page asks the reader for the
// password and opens the snapshot in their browser. PBKDF2-SHA256 (600,000 rounds) turns the password into an AES-256-GCM key; the key never leaves the page.
//
// No import, no DOM: it runs in Node (the generator) and in the browser (the viewer) through WebCrypto, and the browser build pastes this file in as it is (see viewer.mjs).
// A wrong password and a changed file both fail the same way (`password`): GCM cannot tell them apart, and the page does not pretend it can.

const sealEnc = new TextEncoder()
const sealDec = new TextDecoder('utf-8', { fatal: true })

export const SEAL_KIND = 'kybernos-snapshot'
export const SEAL_VERSION = 1
export const SEAL_ITERATIONS = 600000
/** What a viewer accepts in an envelope: a hostile file must not make a tab compute for an hour, and a weak one must not pass for sealed. */
export const SEAL_ITERATIONS_MIN = 100000
export const SEAL_ITERATIONS_MAX = 2000000
export const PASSWORD_MIN = 12
const SEAL_AAD = SEAL_KIND + '/' + SEAL_VERSION
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 32 signs: no I, no O, no 0, no 1; 256 is a multiple of 32, so a random byte maps without bias

export class SealError extends Error {
  constructor (code, message) { super(message); this.name = 'SealError'; this.code = code }
}

export const toB64u = (bytes) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const fromB64u = (text) => {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) throw new SealError('format', 'not a base64url text')
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

const sealSubtle = () => {
  const c = globalThis.crypto
  if (c === undefined || c === null || c.subtle === undefined) throw new SealError('unsupported', 'this browser cannot open a protected page (WebCrypto is missing; it needs a secure page, https or a file)')
  return c
}
const sealKey = async (password, salt, iterations, usage) => {
  const c = sealSubtle()
  const base = await c.subtle.importKey('raw', sealEnc.encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveKey'])
  return c.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, usage)
}

/** Whether a parsed file is a sealed snapshot (not whether it is a good one: `openSealed` says). */
export const isSealed = (o) => o !== null && typeof o === 'object' && o.kind === SEAL_KIND && o.sealed === true

/** A password for a person to pass on: 20 signs in four groups (100 bits), no sign that is mistaken for another. */
export function newPassword () {
  const bytes = sealSubtle().getRandomValues(new Uint8Array(20))
  let out = ''
  for (let i = 0; i < 20; i++) out += (i > 0 && i % 5 === 0 ? '-' : '') + PASSWORD_ALPHABET[bytes[i] % 32]
  return out
}

/** The text of a snapshot, sealed under a password: the envelope to publish. `iterations` is for tests; a longer one is never refused, a shorter one is. */
export async function sealText (text, password, { iterations = SEAL_ITERATIONS } = {}) {
  if (typeof password !== 'string' || Array.from(password).length < PASSWORD_MIN) throw new SealError('weak', 'the password needs at least ' + PASSWORD_MIN + ' characters')
  if (!Number.isInteger(iterations) || iterations < SEAL_ITERATIONS_MIN || iterations > SEAL_ITERATIONS_MAX) throw new SealError('format', 'iterations out of range')
  const c = sealSubtle()
  const salt = c.getRandomValues(new Uint8Array(16))
  const iv = c.getRandomValues(new Uint8Array(12))
  const key = await sealKey(password, salt, iterations, ['encrypt'])
  const data = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: sealEnc.encode(SEAL_AAD) }, key, sealEnc.encode(String(text))))
  return { kind: SEAL_KIND, version: SEAL_VERSION, sealed: true, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64u(salt) }, cipher: { name: 'AES-GCM', iv: toB64u(iv) }, data: toB64u(data) }
}

/** The text inside an envelope. Throws a `SealError`: `format` (not an envelope this page knows), `password` (wrong password, or the file was changed). */
export async function openSealed (env, password) {
  if (!isSealed(env) || env.version !== SEAL_VERSION) throw new SealError('format', 'not a protected snapshot this page can open')
  const kdf = env.kdf
  const cipher = env.cipher
  if (kdf === null || typeof kdf !== 'object' || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || !Number.isInteger(kdf.iterations) || kdf.iterations < SEAL_ITERATIONS_MIN || kdf.iterations > SEAL_ITERATIONS_MAX) throw new SealError('format', 'unknown key derivation')
  if (cipher === null || typeof cipher !== 'object' || cipher.name !== 'AES-GCM' || typeof env.data !== 'string') throw new SealError('format', 'unknown cipher')
  const salt = fromB64u(kdf.salt)
  const iv = fromB64u(cipher.iv)
  const data = fromB64u(env.data)
  if (salt.length !== 16 || iv.length !== 12 || data.length < 16) throw new SealError('format', 'the envelope is malformed')
  const c = sealSubtle()
  const key = await sealKey(typeof password === 'string' ? password : '', salt, kdf.iterations, ['decrypt'])
  let plain
  try { plain = await c.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: sealEnc.encode(SEAL_AAD) }, key, data) } catch (e) { throw new SealError('password', 'wrong password') }
  try { return sealDec.decode(plain) } catch (e) { throw new SealError('format', 'the snapshot is not text') }
}
