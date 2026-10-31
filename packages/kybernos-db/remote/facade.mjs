// facade.mjs — what the agent (and the page's reads) get in place of a db that is published: the read-only mirror for everything that reads, the hosted app for the writes of rows,
// and a plain refusal (`published`) for everything else.
//
// A published app's truth is the hosted copy. The folder on this computer is a mirror of it, refreshed from it. So:
//   - every read answers from the mirror, synchronously, exactly as a local db would (the facade looks the live mirror up at each call: it is replaced when it is refreshed);
//   - a write of a row (create, update, remove, restore) goes to the hosted app and returns a PROMISE of the usual store answer, after the mirror has been refreshed (the tools
//     `await` it; awaiting a plain value is a no-op, so a local db is unchanged);
//   - anything that would change the structure, a view, a profile or the app itself answers `{ ok: false, code: 'published', message }` at once.
//
// There is no Proxy on purpose: an object that answers every name would also answer `then`, and could be awaited forever. The names are listed.

export const PUBLISHED_MESSAGE = 'This app is published: its data lives in the web app. Unpublish it first to change its structure or its views.'
const refused = () => ({ ok: false, code: 'published', message: PUBLISHED_MESSAGE })

/**
 * The door's shape of an answer (`error`, what the page's routes send) from the store's (`code`, what the tools read). A success is the same in both. A refusal keeps the two things
 * the page needs to act on it: `fields` (the sensitive fields that keep an app from being published) and `canForget` (whether Unpublish may offer the way out).
 */
export const doorShape = (r) => (r.ok === true ? r : {
  ok: false, error: r.code || 'failed', message: r.message || 'the web app refused it',
  ...(Array.isArray(r.errors) ? { errors: r.errors } : {}),
  ...(Array.isArray(r.fields) ? { fields: r.fields } : {}),
  ...(typeof r.canForget === 'boolean' ? { canForget: r.canForget } : {}),
})

/** Reads the mirror answers, by the store's own method names. */
export const MIRROR_READS = Object.freeze(['info', 'fingerprint', 'objects', 'profiles', 'listViews', 'getView', 'viewStamps', 'get', 'backlinks', 'list', 'count', 'journal', 'verify', 'referenced'])
/** Everything the store has that changes a db and is not a write of a row: refused while the app is published. */
export const REFUSED = Object.freeze(['addObject', 'archiveObject', 'restoreObject', 'deleteObject', 'archive', 'unarchive', 'addField', 'updateObject', 'updateField', 'saveView', 'removeView', 'setProfiles', 'apply', 'seal', 'gc', 'attach', 'backup'])

/**
 * `rawOf()` gives `{ ok, db }` for the live mirror (store/db.mjs's handle, reopened after each refresh). `row({ op, object, id?, values?, by })` writes one row to the hosted app and
 * answers a Promise of the store's shape (`{ ok: true, record, applied? }` or `{ ok: false, code, message, errors? }`).
 */
export function makeFacade ({ rawOf, row }) {
  const live = () => {
    const r = rawOf()
    if (!r.ok) throw new Error(r.message || 'the copy of this app cannot be read')
    return r.db
  }
  const out = { published: true }
  for (const name of MIRROR_READS) out[name] = (...args) => live()[name](...args)
  for (const name of REFUSED) out[name] = refused
  Object.defineProperty(out, 'file', { enumerable: true, get: () => live().file })
  // the attachments can be read, never put: a file reaches the app through the hosted app's own door
  out.blobs = {
    get dir () { return live().blobs.dir },
    hash: (bytes) => live().blobs.hash(bytes),
    has: (hash) => live().blobs.has(hash),
    get: (hash) => live().blobs.get(hash),
    stat: (hash) => live().blobs.stat(hash),
    list: () => live().blobs.list(),
    put: refused,
    remove: refused,
  }
  out.create = (object, values, by) => row({ op: 'create', object, values, by })
  out.update = (object, id, values, by) => row({ op: 'update', object, id, values, by })
  out.remove = (object, id, by) => row({ op: 'delete', object, id, by })
  out.restore = (object, id, by) => row({ op: 'restore', object, id, by })
  out.close = () => {}
  return out
}
