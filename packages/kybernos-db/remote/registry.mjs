// registry.mjs — which apps of this computer are published, and the team space each one lives in. One small JSON file under the same data root as the dbs
// (`<DSH home>/kybernos/kybernos-db/published.json`), mode 0600, written atomically (a temporary file, fsynced, then one rename).
//
//   { version: 1,
//     spaces:  [{ id, url, bootKey }],                         the team spaces this computer can reach; `bootKey` is the secret that mints the owner's tokens
//     apps:    [{ db, space, slug, since }],                   a published app: the db id here, the space it lives in, its slug there, when
//     pending: [{ db, space, slug, at }] }                     an upload that has started and is not registered yet (so a crash cannot leave a stray app nobody knows about)
//
// The boot key is the secret of this file: nothing here ever returns it except `space(id)` / `spaceOf(db)`, which only the code that talks to the space calls, and it is never
// part of a state, a log line or an error message. A file that cannot be read as this shape is moved aside (`.bad-<time>`, never deleted) and the registry starts empty.
// Pure but for the one file: the clock is injected.
import { randomBytes } from 'node:crypto'
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { isUlid } from '../core/index.mjs'
import { normalizeSpaceUrl } from './space.mjs'
import { hexKey } from './token.mjs'

export const REGISTRY_FILE = 'published.json'
export const REGISTRY_VERSION = 1
export const SPACE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
export const SLUG = /^[a-z][a-z0-9-]{0,39}$/
export const isSlug = (s) => typeof s === 'string' && SLUG.test(s)

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const iso = (s) => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s))
const refuse = (code, message) => ({ ok: false, code, message })

/** A space as the registry keeps it, or null: a plain id, a URL the client may talk to, a hex key of at least 16 bytes. */
export function cleanSpace (s) {
  if (!plain(s) || typeof s.id !== 'string' || !SPACE_ID.test(s.id)) return null
  const url = normalizeSpaceUrl(s.url)
  if (url === null || hexKey(s.bootKey) === null) return null
  return { id: s.id, url, bootKey: s.bootKey }
}
const cleanApp = (a) => (plain(a) && isUlid(a.db) && typeof a.space === 'string' && SPACE_ID.test(a.space) && isSlug(a.slug) && iso(a.since) ? { db: a.db, space: a.space, slug: a.slug, since: a.since } : null)
const cleanPending = (a) => (plain(a) && isUlid(a.db) && typeof a.space === 'string' && SPACE_ID.test(a.space) && isSlug(a.slug) && iso(a.at) ? { db: a.db, space: a.space, slug: a.slug, at: a.at } : null)

/** The whole file read as a registry: `{ spaces, apps, pending }`, or null when it is not one. Entries that do not hold up are refused, not repaired. */
function parse (text) {
  let raw
  try { raw = JSON.parse(text) } catch (e) { return null }
  if (!plain(raw) || raw.version !== REGISTRY_VERSION || !Array.isArray(raw.spaces) || !Array.isArray(raw.apps)) return null
  const spaces = raw.spaces.map(cleanSpace)
  const apps = raw.apps.map(cleanApp)
  const pending = (Array.isArray(raw.pending) ? raw.pending : []).map(cleanPending)
  if (spaces.includes(null) || apps.includes(null) || pending.includes(null)) return null
  if (new Set(spaces.map((s) => s.id)).size !== spaces.length || new Set(apps.map((a) => a.db)).size !== apps.length) return null
  if (apps.some((a) => !spaces.some((s) => s.id === a.space))) return null
  return { spaces, apps, pending }
}

/** Writes a file whole or not at all: a private temporary file beside it, fsynced, then renamed over it. */
function writeAtomic (file, text) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = file + '.tmp-' + randomBytes(6).toString('hex')
  let fd = null
  try {
    fd = openSync(tmp, 'wx', 0o600)
    writeSync(fd, text)
    fsyncSync(fd)
    closeSync(fd)
    fd = null
    try { chmodSync(tmp, 0o600) } catch (e) { /* a file system without modes */ }
    renameSync(tmp, file)
  } catch (e) {
    try { if (fd !== null) closeSync(fd) } catch (e2) { /* already closed */ }
    try { rmSync(tmp, { force: true }) } catch (e2) { /* nothing to remove */ }
    throw e
  }
}

/** `file` is the path of published.json. Nothing is read until the first question. */
export function openPublishedRegistry ({ file, now = Date.now }) {
  let data = null
  let fault = null
  const load = () => {
    if (data !== null) return data
    let text = null
    try { text = readFileSync(file, 'utf8') } catch (e) { text = null }
    if (text === null) { data = { spaces: [], apps: [], pending: [] }; return data }
    const parsed = parse(text)
    if (parsed === null) {
      // not ours or damaged: keep the bytes beside it for someone to look at, and start empty rather than guess
      try { renameSync(file, file + '.bad-' + now()) } catch (e) { /* cannot move it: it is simply not used */ }
      fault = 'unreadable'
      data = { spaces: [], apps: [], pending: [] }
      return data
    }
    data = parsed
    return data
  }
  /** Replaces the data with `next` once it is on disk; on a failed write the old data stays. */
  const commit = (next) => {
    try { writeAtomic(file, JSON.stringify({ version: REGISTRY_VERSION, ...next }, null, 2) + '\n') } catch (e) { return refuse('registry', 'the list of published apps could not be saved') }
    data = next
    return { ok: true }
  }
  const copyOf = () => { const d = load(); return { spaces: d.spaces.map((s) => ({ ...s })), apps: d.apps.map((a) => ({ ...a })), pending: d.pending.map((a) => ({ ...a })) } }

  return {
    file,
    /** `'unreadable'` when the file was moved aside at load, else null. */
    get fault () { load(); return fault },
    /** The spaces, with their keys: only the code that talks to a space asks for these. */
    spaces: () => load().spaces.map((s) => ({ ...s })),
    space: (id) => { const s = load().spaces.find((x) => x.id === id); return s === undefined ? null : { ...s } },
    apps: () => load().apps.map((a) => ({ ...a })),
    appOf: (db) => { const a = load().apps.find((x) => x.db === db); return a === undefined ? null : { ...a } },
    published: (db) => load().apps.some((a) => a.db === db),
    /** `{ app, space }` for a published db, or null. */
    spaceOf (db) {
      const d = load()
      const app = d.apps.find((x) => x.db === db)
      const space = app === undefined ? undefined : d.spaces.find((s) => s.id === app.space)
      return space === undefined ? null : { app: { ...app }, space: { ...space } }
    },
    slugsIn: (spaceId) => load().apps.filter((a) => a.space === spaceId).map((a) => a.slug).concat(load().pending.filter((a) => a.space === spaceId).map((a) => a.slug)),
    /** Adds a space or replaces the one with that id (its URL or key may have moved). */
    addSpace (s) {
      const clean = cleanSpace(s)
      if (clean === null) return refuse('invalid', 'a space is { id, url, bootKey }')
      const next = copyOf()
      next.spaces = next.spaces.filter((x) => x.id !== clean.id).concat([clean])
      return commit(next)
    },
    removeSpace (id) {
      const next = copyOf()
      if (next.apps.some((a) => a.space === id) || next.pending.some((a) => a.space === id)) return refuse('in-use', 'an app still lives in that space')
      next.spaces = next.spaces.filter((x) => x.id !== id)
      return commit(next)
    },
    addApp (a) {
      const clean = cleanApp(a)
      if (clean === null) return refuse('invalid', 'an app is { db, space, slug, since }')
      const next = copyOf()
      if (!next.spaces.some((s) => s.id === clean.space)) return refuse('unknown-space', 'no such space')
      if (next.apps.some((x) => x.db === clean.db)) return refuse('published', 'that app is already published')
      if (next.apps.some((x) => x.space === clean.space && x.slug === clean.slug)) return refuse('slug-taken', 'that slug is taken in the space')
      next.apps.push(clean)
      next.pending = next.pending.filter((x) => x.db !== clean.db)
      return commit(next)
    },
    removeApp (db) {
      const next = copyOf()
      next.apps = next.apps.filter((x) => x.db !== db)
      return commit(next)
    },
    pendingOf: (db) => load().pending.filter((x) => x.db === db).map((x) => ({ ...x })),
    addPending (a) {
      const clean = cleanPending(a)
      if (clean === null) return refuse('invalid', 'a pending upload is { db, space, slug, at }')
      const next = copyOf()
      next.pending = next.pending.filter((x) => !(x.db === clean.db && x.slug === clean.slug)).concat([clean])
      return commit(next)
    },
    removePending (db, slug) {
      const next = copyOf()
      next.pending = next.pending.filter((x) => !(x.db === db && (slug === undefined || x.slug === slug)))
      return commit(next)
    },
  }
}
