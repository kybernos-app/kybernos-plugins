// The Journal of a task, as a page behind a link that expires: what a person's assistant gives them when a task Kaby did on their cloud computer is finished.
//
// The Journal page already exists (the plugin's `POST /kybernos/journal/page` builds it from a chat's own events: who did what, with which model, what it cost, what was delivered). This file
// asks for it over loopback, saves it as a file next to DSH's data, and makes the token that the computer's gate (packages/kybernos-gate/core/page-link.mjs) accepts for a few minutes. The gate lets
// nothing through without the person's sign-in except that page: the link shows it and gives no session.
//
// The two packages import nothing from each other, so the token's shape is written twice and `test-kyby-journal-link.mjs` checks that what is made here is accepted by the gate's reader.
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const b64 = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

/** How long a link opens the page. A few minutes: the person gets it in a chat and opens it there and then; a later wish asks for a new one. */
export const LINK_TTL_MS = 15 * 60_000
/** The most pages kept on the disk, and the longest one stays (the link itself is over long before). */
export const PAGES_KEEP = 20
export const PAGES_MAX_AGE_MS = 24 * 3_600_000
/** The biggest page taken from DSH (the route's own answer is bounded too). */
const PAGE_MAX_BYTES = 6 * 1024 * 1024

export const pagesDir = (dshHome) => join(dshHome, 'kybernos', 'journal-pages')

/** The key that signs the links, made from the computer's token (never the token itself). */
export const pageKey = (computerToken) => createHmac('sha256', String(computerToken)).update('kybernos-journal-page-v1').digest()

/** `<id>.<expiresAtMs>.<signature>`: what the gate reads. `id` names the file. */
export function mintPageToken ({ key, now = Date.now(), ttlMs = LINK_TTL_MS, id = b64(randomBytes(16)) }) {
  const expiresAt = Math.floor(now + ttlMs)
  const signature = b64(createHmac('sha256', key).update(`page|${id}|${expiresAt}`).digest())
  return { id, expiresAt, token: `${id}.${expiresAt}.${signature}` }
}

/**
 * The cookie DSH reads as a signed-in browser's, for one request to this very computer over loopback (the scheme of kybernos-plugin/session-guard.mjs: name `dsh-auth-` + b64url(sha256(authority)),
 * value `v1.` + body + `.` + b64url(hmac(secret, body))). It lives for a minute and is never kept: it is how this plugin asks its sibling for the page, as the person's own page would.
 */
export function loopbackCookie ({ secret, port, now = Date.now(), ttlMs = 60_000 }) {
  if (!Buffer.isBuffer(secret) || secret.byteLength === 0) return null
  const authority = `127.0.0.1:${port}`
  const body = b64(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + ttlMs }), 'utf8'))
  const value = `v1.${body}.${b64(createHmac('sha256', secret).update(body).digest())}`
  return 'dsh-auth-' + b64(createHash('sha256').update(authority).digest()) + '=' + value
}

/** Writes a page and forgets the old ones: the newest `keep`, and none older than `maxAgeMs`. Returns the file's name. */
export function savePage ({ dir, id, html, now = Date.now(), keep = PAGES_KEEP, maxAgeMs = PAGES_MAX_AGE_MS }) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const name = id + '.html'
  writeFileSync(join(dir, name), html, { mode: 0o600 })
  try {
    const pages = readdirSync(dir).filter((f) => /^[A-Za-z0-9_-]{22}\.html$/u.test(f)).map((f) => {
      try { return { f, at: statSync(join(dir, f)).mtimeMs } } catch (e) { return { f, at: 0 } }
    }).sort((a, b) => b.at - a.at)
    pages.forEach((p, i) => {
      if (p.f === name) return
      if (i >= keep || now - p.at > maxAgeMs) { try { unlinkSync(join(dir, p.f)) } catch (e) { /* already gone */ } }
    })
  } catch (e) { /* the sweep never stops a page from being saved */ }
  return name
}

/**
 * Asks DSH (this very listener, over loopback) for the Journal page of a chat, saves it and returns its link's path and end time.
 * Never throws: `{ ok: false, error }` with a short code when anything is missing (no machine secret, no page, a page that is too big).
 * `computerToken` is the computer's own: it is what the gate's key comes from.
 */
export async function makeJournalLink ({ port, sessionId, computerToken, secret, dir, lang = 'en', now = Date.now(), fetchImpl = fetch, random = () => b64(randomBytes(16)) }) {
  try {
    if (typeof sessionId !== 'string' || /^[A-Za-z0-9_-]{1,80}$/u.test(sessionId) === false) return { ok: false, error: 'bad_session' }
    if (typeof computerToken !== 'string' || computerToken === '') return { ok: false, error: 'no_computer' }
    const cookie = loopbackCookie({ secret, port, now })
    if (cookie === null) return { ok: false, error: 'no_secret' }
    const origin = `http://127.0.0.1:${port}`
    const r = await fetchImpl(`${origin}/kybernos/journal/page`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, cookie },
      body: JSON.stringify({ sessionId, lang: lang === 'fr' ? 'fr' : 'en' }),
      signal: AbortSignal.timeout(25_000)
    })
    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch (e) { json = null }
    if (r.status !== 200 || json === null || json.ok !== true || typeof json.html !== 'string' || json.html === '') return { ok: false, error: r.status === 404 ? 'no_journal' : 'page_failed' }
    if (Buffer.byteLength(json.html, 'utf8') > PAGE_MAX_BYTES) return { ok: false, error: 'page_too_big' }
    const minted = mintPageToken({ key: pageKey(computerToken), now, id: random() })
    savePage({ dir, id: minted.id, html: json.html, now })
    return { ok: true, path: '/__gate/page/' + minted.token, expires_at: new Date(minted.expiresAt).toISOString() }
  } catch (e) {
    return { ok: false, error: 'page_failed' }
  }
}
