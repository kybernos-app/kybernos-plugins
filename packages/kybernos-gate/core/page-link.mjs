// A page the computer made for a link that expires: the way a person's assistant hands them the Journal of a task.
//
// The gate lets nothing through without the person's own sign-in, so a link cannot simply point at DSH. This is the one other thing it serves, and it serves only that:
// a page the cloud plugin saved as a file (`<DSH_HOME>/kybernos/journal-pages/<id>.html`), asked for with a token that carries its own id and end time and is signed with a key only this
// computer and its plugin can make from the computer's token. No sign-in follows from it: opening the link shows that one page and nothing else.
//
//   token = <id>.<expiresAtMs>.<signature>      id: 22 URL-safe characters (16 random bytes)      signature: b64url(HMAC-SHA256(key, 'page|' + id + '|' + expiresAtMs))
//   key   = HMAC-SHA256(<the computer's token>, 'kybernos-journal-page-v1')
//
// `packages/kybernos-cloud/kyby-journal-link.mjs` makes these (the two packages import nothing from each other: its test checks that what it makes is accepted here).
import { createHmac, timingSafeEqual } from 'node:crypto'

const b64 = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
const TOKEN_RE = /^([A-Za-z0-9_-]{22})\.(\d{13})\.([A-Za-z0-9_-]{43})$/u

/** The key that signs the pages' links, made from the computer's token (never the token itself). */
export const pageKey = (computerToken) => createHmac('sha256', String(computerToken)).update('kybernos-journal-page-v1').digest()

/**
 * What a token says, or null when it is not one of ours (bad shape, bad signature). `expired` is true after its end time: the answer is « this link is over », not « not found ».
 * @returns {{ id: string, expiresAt: number, expired: boolean } | null}
 */
export function readPageToken (key, token, now = Date.now()) {
  const m = typeof token === 'string' ? TOKEN_RE.exec(token) : null
  if (m === null || !Buffer.isBuffer(key) || key.byteLength === 0) return null
  const want = Buffer.from(b64(createHmac('sha256', key).update(`page|${m[1]}|${m[2]}`).digest()))
  const have = Buffer.from(m[3])
  if (want.length !== have.length || timingSafeEqual(want, have) !== true) return null
  const expiresAt = Number(m[2])
  return { id: m[1], expiresAt, expired: !(expiresAt > now) }
}
