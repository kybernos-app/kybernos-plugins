// Password hashing for the gate: scrypt, no dependency.
//
// A stored verifier looks like `scrypt$N$r$p$<salt>$<hash>` (salt and hash are base64url). The work is done
// with the ASYNC scrypt so a login never blocks the event loop that also carries the proxied WebSockets.
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto'

const KEY_LENGTH = 32
const SALT_LENGTH = 16
// OWASP's scrypt floor is N=2^17 with r=8; 2^15 keeps a login near 100 ms and the limiter caps the guessing rate.
export const DEFAULT_PARAMS = Object.freeze({ N: 32768, r: 8, p: 1 })
// A verifier comes from an env var: refuse parameters that would let it ask for gigabytes of memory.
const LIMITS = Object.freeze({ N: 1 << 20, r: 16, p: 4 })

const b64 = (buf) => buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
const unb64 = (text) => (/^[A-Za-z0-9_-]+$/u.test(text) ? Buffer.from(text.replaceAll('-', '+').replaceAll('_', '/'), 'base64') : null)

const derive = (password, salt, { N, r, p }) => new Promise((resolve, reject) => {
  scrypt(Buffer.from(password, 'utf8'), salt, KEY_LENGTH, { N, r, p, maxmem: 160 * N * r + (1 << 20) }, (err, key) => (err ? reject(err) : resolve(key)))
})

const isPowerOfTwo = (n) => Number.isInteger(n) && n > 1 && (n & (n - 1)) === 0

/** Parse a stored verifier; null when it is malformed or asks for more than the limits allow. */
export function parseVerifier (stored) {
  if (typeof stored !== 'string') return null
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  if (!isPowerOfTwo(N) || N > LIMITS.N || !Number.isInteger(r) || r < 1 || r > LIMITS.r || !Number.isInteger(p) || p < 1 || p > LIMITS.p) return null
  const salt = unb64(parts[4])
  const hash = unb64(parts[5])
  if (salt === null || hash === null || salt.length < 8 || hash.length !== KEY_LENGTH) return null
  return { N, r, p, salt, hash }
}

/** Build a verifier for `password`. `params` is for tests, which use a small N. */
export async function hashPassword (password, params = DEFAULT_PARAMS) {
  if (typeof password !== 'string' || password === '') throw new Error('password must be a non-empty string')
  const salt = randomBytes(SALT_LENGTH)
  const hash = await derive(password, salt, params)
  return ['scrypt', params.N, params.r, params.p, b64(salt), b64(hash)].join('$')
}

/** True when `password` matches the stored verifier. Never throws on a bad verifier: it answers false. */
export async function verifyPassword (password, stored) {
  const v = parseVerifier(stored)
  if (v === null || typeof password !== 'string') return false
  let key
  try { key = await derive(password, v.salt, v) } catch (e) { return false }
  return key.length === v.hash.length && timingSafeEqual(key, v.hash)
}
