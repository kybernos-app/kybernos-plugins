// ULIDs: the ids of records and operations. 26 Crockford base32 characters, the first ten a millisecond timestamp, so ids sort in the order they were made.
//
// `encodeUlid` is pure. `makeUlid` is the generator: it takes the clock and the randomness as ports, and never goes backwards or repeats, even for two ids in the
// same millisecond or when the clock is set back (the next id is the previous one plus one).

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const MAX_MS = 2 ** 48 - 1
const MAX_RANDOM = (1n << 80n) - 1n
export const RANDOM_BYTES = 10

const timePart = (ms) => {
  let out = ''
  let n = ms
  for (let i = 0; i < 10; i++) { out = ALPHABET[n % 32] + out; n = Math.floor(n / 32) }
  return out
}
const randomPart = (value) => {
  let out = ''
  let n = value
  for (let i = 0; i < 16; i++) { out = ALPHABET[Number(n & 31n)] + out; n >>= 5n }
  return out
}
const bigOf = (bytes) => {
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  return n
}

/** The ULID of a millisecond timestamp and ten random bytes. */
export function encodeUlid (ms, bytes) {
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > MAX_MS) throw new RangeError('a ULID timestamp is a whole number of milliseconds below 2^48')
  if (bytes.length !== RANDOM_BYTES) throw new RangeError('a ULID takes ' + RANDOM_BYTES + ' random bytes')
  return timePart(ms) + randomPart(bigOf(bytes))
}

/** The millisecond timestamp inside a ULID. */
export function ulidTime (id) {
  let ms = 0
  for (let i = 0; i < 10; i++) ms = ms * 32 + ALPHABET.indexOf(id[i])
  return ms
}

/**
 * A generator of ULIDs: `next()` for « now », `next(ms)` to stamp an older moment (an operation made by raw SQL gets the id of the moment it was written).
 * `now()` gives milliseconds, `random(n)` gives n random bytes.
 */
export function makeUlid ({ now, random }) {
  let lastMs = -1
  let last = 0n
  return (at) => {
    let ms = Number.isSafeInteger(at) ? at : now()
    if (ms < lastMs) ms = lastMs
    let n
    if (ms === lastMs && last < MAX_RANDOM) n = last + 1n
    else {
      if (ms === lastMs) ms += 1
      n = bigOf(random(RANDOM_BYTES))
    }
    lastMs = ms
    last = n
    return timePart(ms) + randomPart(n)
  }
}
