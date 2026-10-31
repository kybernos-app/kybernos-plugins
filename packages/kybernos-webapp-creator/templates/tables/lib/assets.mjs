// assets.mjs — the files of the page (public/): an explicit list of what is served, each at one address with one content type. They are read once, at start, and held in memory with
// their ETag: a request never reaches the file system, so no path from outside can pick a file, and a folder is never listed. A file in public/ that is not in the list is not served
// (test-tables-front.mjs fails when the list and the folder differ).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const JS = 'text/javascript; charset=utf-8'
/** `address → [file in public/, content type]`. The page itself is served at `/`. */
export const ASSETS = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  '/js/api.mjs': ['js/api.mjs', JS],
  '/js/dom.mjs': ['js/dom.mjs', JS],
  '/js/forms.mjs': ['js/forms.mjs', JS],
  '/js/main.mjs': ['js/main.mjs', JS],
  '/js/model.mjs': ['js/model.mjs', JS],
  '/js/values.mjs': ['js/values.mjs', JS],
  '/js/views.mjs': ['js/views.mjs', JS],
})

/** `Map<address, { body (Buffer), type, etag }>`, read from `dir` (public/ next to app.mjs by default). */
export function loadAssets (dir = fileURLToPath(new URL('../public/', import.meta.url))) {
  const out = new Map()
  for (const [address, [file, type]] of Object.entries(ASSETS)) {
    const body = readFileSync(dir + file)
    out.set(address, { body, type, etag: '"' + createHash('sha256').update(body).digest('base64url').slice(0, 22) + '"' })
  }
  return out
}

/** The answer for an asset: 304 when the browser already holds this version. Revalidated on every use (`no-cache`), so a new version of the app shows at the next load. */
export function assetResponse (asset, ifNoneMatch) {
  const headers = { etag: asset.etag, 'cache-control': 'no-cache', 'content-type': asset.type }
  if (ifNoneMatch === asset.etag) return new Response(null, { status: 304, headers: { etag: asset.etag, 'cache-control': 'no-cache' } })
  return new Response(asset.body, { status: 200, headers })
}
