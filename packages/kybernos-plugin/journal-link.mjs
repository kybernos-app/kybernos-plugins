// The Journal of a chat as a link on the Kybernos server: make it, update it, take it down, and remember it on this computer.
//
// The server half is the shared-snapshots module of kybernos-server (`/v1/snapshots`, docs/dev/journal-link.md); this file talks to it ONLY through the `snapshots` seam that the cloud
// bundle publishes (the account token stays in that bundle). Without the seam, without an account or on a server that has no such routes, `state` says why and nothing else works.
//
// A link can be protected by a password (the default): the document is sealed here, with the code of the shared dashboards, and the server only ever holds the envelope. The password is
// made here (100 bits), shown to the person with the link, and kept only in the local record (`<dir>/index.json`, mode 600) so that an update keeps the link AND the password the readers
// were given. The record maps a chat to its link; the server is the truth about whether the link still lives (`state` checks the list the server gives back).
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sessionKey } from './journal-seal.mjs'
import { newPassword, sealText } from './vendored-share-seal.mjs'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/u
const MAX_LINKS = 500
const isObj = (v) => v !== null && typeof v === 'object' && Array.isArray(v) === false
const str = (v, max) => (typeof v === 'string' && v !== '' ? v.slice(0, max) : null)

export const linksFile = (dir) => join(dir, 'index.json')

function readRecord (dir) {
  try {
    const rec = JSON.parse(readFileSync(linksFile(dir), 'utf8'))
    return isObj(rec) && isObj(rec.links) ? rec.links : {}
  } catch (e) { return {} }
}

function writeRecord (dir, links) {
  const keys = Object.keys(links)
  if (keys.length > MAX_LINKS) keys.sort((a, b) => String(links[a].made).localeCompare(String(links[b].made))).slice(0, keys.length - MAX_LINKS).forEach((k) => { delete links[k] })
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = linksFile(dir)
  const tmp = file + '.' + process.pid + '.tmp'
  writeFileSync(tmp, JSON.stringify({ v: 1, links: links }), { mode: 0o600 })
  try { chmodSync(tmp, 0o600) } catch (e) { /* not ours to change */ }
  renameSync(tmp, file)
}

/** What the page of the sheet is given about a recorded link (the password only for a protected one). */
const shape = (rec, gone) => ({ url: rec.url, expires: rec.expires, protected: rec.protected === true, password: rec.protected === true ? rec.password : null, made: rec.made, gone: gone === true })

/**
 * `dir`: the folder of the record (a string, or a function that answers it). `seam`: a function that answers the `snapshots` seam of the cloud bundle, or null. `now`: the clock.
 * Every verb answers `{ ok: true, … }` or `{ ok: false, error, message? }` and never throws.
 */
export function createJournalLinks ({ dir, seam, now } = {}) {
  const folder = () => (typeof dir === 'function' ? dir() : dir)
  const seamNow = () => {
    try { const s = typeof seam === 'function' ? seam() : null; return isObj(s) && typeof s.status === 'function' && typeof s.put === 'function' && typeof s.remove === 'function' ? s : null } catch (e) { return null }
  }
  const clock = () => (typeof now === 'function' ? now() : Date.now())
  const keyOf = (sessionId) => { const k = sessionKey(typeof sessionId === 'string' ? sessionId : ''); return SAFE_ID.test(k) ? k : null }

  return {
    /** What the sheet shows: whether a link can be made now (and why not), the limits, and the link this chat already has. */
    state: async (sessionId) => {
      try {
        const key = keyOf(sessionId)
        if (key === null) return { ok: false, error: 'bad_session' }
        const rec = readRecord(folder())[key]
        const known = isObj(rec) && typeof rec.id === 'string' ? rec : null
        const s = seamNow()
        if (s === null) return { ok: true, available: false, reason: 'no_account', link: known === null ? null : shape(known, false) }
        const st = await s.status()
        if (isObj(st) === false || st.ok !== true || st.available !== true) return { ok: true, available: false, reason: isObj(st) && typeof st.error === 'string' ? st.error : 'unavailable', link: known === null ? null : shape(known, false) }
        const live = (Array.isArray(st.links) ? st.links : []).find((l) => isObj(l) && known !== null && l.id === known.id)
        const link = known === null ? null : shape(live !== undefined && typeof live.expires === 'string' ? { ...known, expires: live.expires } : known, live === undefined)
        return { ok: true, available: true, reason: null, limits: { maxBytes: st.maxBytes, maxCount: st.maxCount, ttlDays: st.ttlDays, count: st.count }, link: link }
      } catch (e) { return { ok: false, error: 'internal' } }
    },

    /** Make the link of this chat, or update it (same link, same password). `doc` is the Journal document. `protect` (default true) seals it under a password. `fresh`: make a new link even though one is recorded. */
    publish: async ({ sessionId, doc, protect, fresh } = {}) => {
      try {
        const key = keyOf(sessionId)
        if (key === null) return { ok: false, error: 'bad_session' }
        if (!isObj(doc) || doc.kind !== 'kybernos-journal') return { ok: false, error: 'bad_document' }
        const s = seamNow()
        if (s === null) return { ok: false, error: 'no_account' }
        const st = await s.status()
        if (isObj(st) === false || st.ok !== true || st.available !== true) return { ok: false, error: isObj(st) && typeof st.error === 'string' ? st.error : 'unavailable' }
        const links = readRecord(folder())
        const rec = isObj(links[key]) && typeof links[key].id === 'string' ? links[key] : null
        const onServer = rec !== null && (Array.isArray(st.links) ? st.links : []).some((l) => isObj(l) && l.id === rec.id)
        if (rec !== null && fresh !== true && onServer === false) return { ok: false, error: 'gone' }
        const sealed = protect !== false
        const password = sealed ? (rec !== null && fresh !== true && rec.protected === true && typeof rec.password === 'string' ? rec.password : newPassword()) : null
        const text = JSON.stringify(doc)
        const payload = sealed ? JSON.stringify(await sealText(text, password)) : text
        const bytes = Buffer.byteLength(payload, 'utf8')
        if (typeof st.maxBytes === 'number' && bytes > st.maxBytes) return { ok: false, error: 'too_big', bytes: bytes, maxBytes: st.maxBytes }
        const updating = rec !== null && fresh !== true
        if (rec !== null && fresh === true && onServer) await s.remove(rec.id)
        const put = await s.put({ id: updating ? rec.id : undefined, sealed: sealed, text: payload, doc: 'journal' })
        if (isObj(put) === false || put.ok !== true) {
          if (updating && isObj(put) && put.error === 'not_found') return { ok: false, error: 'gone' }
          return { ok: false, error: isObj(put) && typeof put.error === 'string' ? put.error : 'unavailable', message: isObj(put) && typeof put.message === 'string' ? put.message : '' }
        }
        const made = new Date(clock()).toISOString()
        const next = { id: put.id, url: put.url, expires: str(put.expires, 40), protected: sealed, password: password, made: made, session: key }
        links[key] = next
        try { writeRecord(folder(), links) } catch (e) { return { ok: true, link: shape(next, false), warning: 'not_remembered' } }
        return { ok: true, link: shape(next, false) }
      } catch (e) { return { ok: false, error: 'internal' } }
    },

    /** Take the link of this chat down (on the server, then in the record). A link that is already gone is done. */
    remove: async ({ sessionId } = {}) => {
      try {
        const key = keyOf(sessionId)
        if (key === null) return { ok: false, error: 'bad_session' }
        const links = readRecord(folder())
        const rec = isObj(links[key]) && typeof links[key].id === 'string' ? links[key] : null
        if (rec === null) return { ok: true, removed: false }
        const s = seamNow()
        if (s === null) return { ok: false, error: 'no_account' }
        const r = await s.remove(rec.id)
        if (isObj(r) === false || (r.ok !== true && r.error !== 'not_found')) return { ok: false, error: isObj(r) && typeof r.error === 'string' ? r.error : 'unavailable' }
        delete links[key]
        try { writeRecord(folder(), links) } catch (e) { return { ok: true, removed: true, warning: 'not_forgotten' } }
        return { ok: true, removed: true }
      } catch (e) { return { ok: false, error: 'internal' } }
    },
  }
}
